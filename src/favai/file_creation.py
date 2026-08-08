"""Narrowly scoped capability: create a Beancount source file and include it.

The operation is gated by the HITL capability layer: the write endpoint
consumes a short-lived single-use capability bound to the exact operation
before doing anything, and independently revalidates every path, checksum,
and payload constraint.  There is deliberately no general read, write,
rename, or delete filesystem access anywhere in this module.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from favai.capabilities import CapabilityStore, require_capability
from favai.entries import EntryError

_MAX_CONTENT_BYTES = 100 * 1024  # 100 KiB
_BEANCOUNT_SUFFIX = ".beancount"
_GLOB_RE = re.compile(r"[*?\[\]{}]")
_INCLUDE_RE = re.compile(r'^include\s+"([^"]+)"\s*$')
_SAFE_PATH_COMPONENT_RE = re.compile(r"^[^/\\:]+$")


def _validated_target(ledger: Any, raw_path: Any) -> tuple[Path, Path, str]:
    """Validate the requested relative path beneath the ledger directory.

    Returns ``(root, target, display_path)``.  Raises EntryError for absolute
    paths, traversal, unsafe components, symlink escape, glob patterns,
    non-.beancount suffixes, and special files.
    """
    if not isinstance(raw_path, str) or not raw_path.strip():
        msg = "缺少目标文件路径"
        raise EntryError(msg)
    display_path = raw_path.strip()
    if "\\" in display_path:
        msg = "目标路径不能包含反斜杠"
        raise EntryError(msg)
    display_path = display_path.replace("\\", "/")
    if display_path.startswith("/"):
        msg = "目标路径必须是相对路径，不能以 / 开头"
        raise EntryError(msg)
    components = [part for part in display_path.split("/") if part]
    for component in components:
        if component in (".", ".."):
            msg = "目标路径不能包含 . 或 .."
            raise EntryError(msg)
        if _GLOB_RE.search(component):
            msg = "目标路径不能包含通配符"
            raise EntryError(msg)
        if not _SAFE_PATH_COMPONENT_RE.match(component):
            msg = f"目标路径包含不安全的分量：{component!r}"
            raise EntryError(msg)
    if not display_path.endswith(_BEANCOUNT_SUFFIX):
        msg = "目标文件必须是 .beancount 文件"
        raise EntryError(msg)

    root = Path(ledger.beancount_file_path).resolve().parent
    target = (root / Path(*components)).resolve()
    # Reject symlink escape: the fully resolved target must stay inside root.
    if root != target.parent and not target.is_relative_to(root):
        msg = "目标路径解析后超出账本目录"
        raise EntryError(msg)
    # Reject writing through symlinked parent directories.
    cursor = root
    for component in components[:-1]:
        cursor = cursor / component
        if cursor.is_symlink():
            msg = f"目标路径包含符号链接目录：{component!r}"
            raise EntryError(msg)
    if target.is_symlink():
        msg = "目标路径不能是符号链接"
        raise EntryError(msg)
    if target.is_dir():
        msg = "目标路径指向一个目录"
        raise EntryError(msg)
    return root, target, display_path


def _validated_content(raw_content: Any) -> str:
    """Validate payload size and Beancount syntax of the initial content."""
    if raw_content is None:
        raw_content = ""
    if not isinstance(raw_content, str):
        msg = "initial_content 必须是字符串"
        raise EntryError(msg)
    content = raw_content.replace("\r\n", "\n")
    if len(content.encode("utf-8")) > _MAX_CONTENT_BYTES:
        msg = "initial_content 过大（超过 100 KiB）"
        raise EntryError(msg)
    from beancount.parser.parser import parse_string

    _entries, errors, _options = parse_string(content)
    if errors:
        details = "; ".join(str(e) for e in errors[:5])
        msg = f"initial_content 无法通过 Beancount 语法检查：{details}"
        raise EntryError(msg)
    return content


def _include_line(display_path: str) -> str:
    return f'include "{display_path}"'


def _has_include(source: str, display_path: str) -> bool:
    for line in source.splitlines():
        match = _INCLUDE_RE.match(line.strip())
        if match and match.group(1) == display_path:
            return True
    return False


def create_and_include(ledger: Any, operation: dict[str, Any]) -> dict[str, Any]:
    """Execute the approved create-and-include operation.

    The capability must already have been consumed by the endpoint; this
    function performs the mutation and is idempotent for an already-completed
    identical change.
    """
    _root, target, display_path = _validated_target(ledger, operation.get("path"))
    content = _validated_content(operation.get("initial_content"))
    include_in_main = bool(operation.get("include_in_main"))

    if not include_in_main:
        # Creating a file without including it is out of scope for this
        # capability; reject before mutation.
        msg = "include_in_main 必须为 true"
        raise EntryError(msg)

    main_path = Path(ledger.beancount_file_path).resolve()
    main_source, main_checksum = ledger.file.get_source(main_path)

    exists = target.exists()
    if exists:
        existing = target.read_text("utf-8").replace("\r\n", "\n")
        if existing.rstrip("\n") != content.rstrip("\n"):
            msg = f"目标文件已存在且内容不同，拒绝覆盖：{display_path}"
            raise EntryError(msg)
        # Identical orphan recovery: only the include may be missing.
        if _has_include(main_source, display_path):
            return {
                "created_path": display_path,
                "include_path": str(main_path),
                "already_completed": True,
            }
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content + ("\n" if content else ""), "utf-8")

    if _has_include(main_source, display_path):
        # The file exists with identical content and the include is present.
        return {
            "created_path": display_path,
            "include_path": str(main_path),
            "already_completed": True,
        }

    updated = main_source.rstrip("\n") + "\n\n" + _include_line(display_path) + "\n"
    ledger.file.set_source(main_path, updated, main_checksum)
    return {
        "created_path": display_path,
        "include_path": str(main_path),
        "already_completed": False,
    }


def create_and_include_gated(
    ledger: Any,
    capabilities: CapabilityStore,
    ledger_id: str,
    session_id: str,
    token: str,
    operation: dict[str, Any],
) -> dict[str, Any]:
    """Consume the capability and run the approved operation.

    The backend computes the operation hash itself, so a token minted for a
    different operation (or ledger/session) can never authorize this call.
    """
    require_capability(
        capabilities,
        token,
        operation=operation,
        ledger_id=ledger_id,
        session_id=session_id,
        min_risk="write",
    )
    return create_and_include(ledger, operation)

import { useState } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { t } from "@/i18n";

/**
 * Searchable account picker. Options come from the ledger context, but any
 * free-form text can be committed as a new account.
 */
export function AccountCombobox({
  value,
  accounts,
  onChange,
}: {
  value: string;
  accounts: string[];
  onChange: (account: string) => void;
}) {
  const [inputValue, setInputValue] = useState("");
  const trimmed = inputValue.trim();

  let items = accounts;
  if (trimmed && !items.includes(trimmed)) {
    // Let the user select free-form input as a brand-new account.
    items = [trimmed, ...items];
  }
  if (value && !items.includes(value)) {
    items = [value, ...items];
  }

  return (
    <Combobox
      items={items}
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") {
          onChange(next);
        }
      }}
      onInputValueChange={(next) => setInputValue(next)}
    >
      <ComboboxInput
        placeholder={t("account.search.placeholder")}
        className="w-full"
      />
      <ComboboxContent>
        <ComboboxEmpty>{t("account.empty")}</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

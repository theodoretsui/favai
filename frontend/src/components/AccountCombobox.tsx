import { AutoComplete, Empty } from "antd";

import { t } from "@/i18n";

export function AccountCombobox({
  value,
  accounts,
  onChange,
}: {
  value: string;
  accounts: string[];
  onChange: (account: string) => void;
}) {
  return (
    <AutoComplete
      value={value}
      className="w-full"
      options={accounts.map((account) => ({ label: account, value: account }))}
      placeholder={t("account.search.placeholder")}
      filterOption={(input, option) =>
        String(option?.value ?? "")
          .toLocaleLowerCase()
          .includes(input.toLocaleLowerCase())
      }
      notFoundContent={
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("account.empty")}
        />
      }
      onChange={onChange}
      onSelect={onChange}
    />
  );
}

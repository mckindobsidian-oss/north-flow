/** Keep task dates compact and predictable while the user types DD/MM/YYYY. */
export function formatTaskDateInput(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)]
    .filter(Boolean)
    .join("/");
}

export const taskDateText = (iso) => iso
  ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
  : "";

/** Convert a real DD/MM/YYYY date to North's YYYY-MM-DD key. */
export function parseTaskDate(value) {
  if (!String(value || "").trim()) return "";
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value).trim());
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const date = new Date(year, month - 1, day);
  return year >= 1900 && year <= 9999 && date.getFullYear() === year &&
    date.getMonth() === month - 1 && date.getDate() === day
    ? `${yearText}-${monthText}-${dayText}`
    : null;
}

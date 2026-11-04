/** Quote every cell and neutralize spreadsheet formula prefixes in untrusted text. */
export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  // Control characters are intentionally included to stop prefix evasion.
  // eslint-disable-next-line no-control-regex
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

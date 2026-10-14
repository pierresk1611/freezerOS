// Compare actual JSON fields, not only names or generic text fragments.
export const editableFields = [
  "name",
  "portions",
  "ingredients",
  "steps",
  "reheating",
  "storage",
  "meat",
  "freezing",
];
const metadataFields = new Set([
  "id",
  "recipe_id",
  "user_id",
  "version",
  "created_at",
]);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export function samePayload(row, payload) {
  return (
    JSON.stringify(
      canonical(
        Object.fromEntries(editableFields.map((key) => [key, row[key]])),
      ),
    ) ===
    JSON.stringify(
      canonical(
        Object.fromEntries(editableFields.map((key) => [key, payload[key]])),
      ),
    )
  );
}
export function canCorrect(row, item) {
  return (
    row.version === 1 &&
    samePayload(row, item.before) &&
    Object.entries(row).every(
      ([key, value]) =>
        editableFields.includes(key) ||
        metadataFields.has(key) ||
        value === null,
    )
  );
}
export function correctionStatus(row, item) {
  return samePayload(row, item.after)
    ? "corrected"
    : canCorrect(row, item)
      ? "eligible"
      : "modified";
}

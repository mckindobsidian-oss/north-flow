export const DEFAULT_THEME = "violet-dusk";
export function validAppearance(value) {
  return Boolean(value && typeof value.id === "string" && Number.isFinite(value.at) &&
    (value.id !== "custom" || (typeof value.photo?.data === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(value.photo.data) && value.photo.data.length <= 4.5 * 1024 * 1024)));
}
export function newestAppearance(...values) {
  return values.filter(validAppearance).sort((a, b) => b.at - a.at)[0] || null;
}

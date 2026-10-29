export const THEMES = {
  "event-horizon": ["event-horizon.png", "#f0b65a"],
  "violet-dusk": ["violet-dusk.png", "#c3b0ff"],
  "obsidian-flow": ["obsidian-flow.png", "#d3d6e0"],
  "ember-horizon": ["ember-horizon.png", "#ffb08a"],
  "monochrome-terrain": ["monochrome-terrain.png", "#d5d7df"],
  "sculpted-bronze": ["sculpted-bronze-ribbon.png", "#d2a176"],
  "luminous-violet": ["luminous-violet-ribbon.png", "#d694ff"],
};
export function applyTheme(theme, appearance) {
  const photo = appearance?.id === "custom" ? appearance.photo?.data : null;
  const custom = typeof photo === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(photo) && photo.length <= 4.5 * 1024 * 1024;
  const id = Object.hasOwn(THEMES, appearance?.id) ? appearance.id : Object.hasOwn(THEMES, theme) ? theme : "violet-dusk";
  const [wallpaper, accent] = THEMES[id];
  document.body.dataset.theme = id;
  document.body.style.setProperty("--wallpaper", custom ? `url("${photo}")` : `url("wallpapers/${wallpaper}")`);
  document.body.style.setProperty("--accent", accent);
  document.body.style.setProperty("--acc", accent);
}

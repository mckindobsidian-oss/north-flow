export function themeStyles(styles, light) {
  if (!light) return { ...styles };
  return Object.fromEntries(Object.entries(styles).map(([key, value]) => [key, {
    ...value,
    ...(value.color ? { color: key.toLowerCase().includes('error') ? '#a51d38' : '#202330' } : {}),
    ...(value.backgroundColor ? { backgroundColor: value.backgroundColor === 'transparent' ? 'transparent' : '#f7f8f2ed' } : {}),
    ...(value.borderColor ? { borderColor: '#22283b30' } : {}),
  }]));
}

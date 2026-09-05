const WINDOWS_RESERVED = '\\/:*?"<>|#[]^';

export function hasAsciiControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

export function hasWindowsReservedCharacter(value: string): boolean {
  return hasAsciiControl(value) || [...value].some((character) => WINDOWS_RESERVED.includes(character));
}

export function hasSpecialLinkCharacter(value: string): boolean {
  return [...value].some((character) => "#|[]".includes(character));
}

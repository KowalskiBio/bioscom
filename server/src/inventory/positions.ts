import type { Container, Shelf } from "@bioscom/shared";

export function getFirstLetter(name: string): string {
  if (!name) {
    return "?";
  }
  const normalized = name.normalize("NFD").replace(/\p{M}/gu, "");
  const match = normalized.match(/[A-Za-z]/);
  return match !== null && match[0] !== undefined ? match[0].toUpperCase() : "?";
}

export function generateNextPositionCode(container: Container, name: string): string {
  const letter = getFirstLetter(name);
  let maxNum = 0;
  for (const shelf of container.shelves) {
    for (const chemical of shelf.chemicals) {
      const pos = chemical.position || chemical.customPosition || "";
      if (pos.startsWith(letter)) {
        const numPart = parseInt(pos.slice(1), 10);
        if (!Number.isNaN(numPart) && numPart > maxNum) {
          maxNum = numPart;
        }
      }
    }
  }
  return letter + (maxNum + 1);
}

export function generateSequentialBoxPosition(shelf: Shelf): string {
  const occupied = new Set<string>();
  for (const chemical of shelf.chemicals) {
    const pos = (chemical.position || chemical.customPosition || "").trim().toUpperCase();
    if (/^[A-Z]\d+$/.test(pos)) {
      occupied.add(pos);
    }
  }
  for (let charCode = 65; charCode <= 90; charCode += 1) {
    const letter = String.fromCharCode(charCode);
    for (let num = 1; num <= 9; num += 1) {
      const candidate = letter + num;
      if (!occupied.has(candidate)) {
        return candidate;
      }
    }
  }
  return "A1";
}

export function getOrCreatePosition(container: Container, shelf: Shelf, chemName: string): string {
  if (container.type === "cabinet") {
    const isAlphabetical =
      container.cabinetMethod === "alphabetical" ||
      (container.cabinetMethod === "custom" && container.customRangeType === "alphabetical");
    if (isAlphabetical) {
      let shelfLetter = "A";
      const rangeMatch = /Shelf\s+([A-Za-z])(?:-|\u2013)/i.exec(shelf.name);
      if (rangeMatch !== null) {
        shelfLetter = (rangeMatch[1] ?? "A").toUpperCase();
      } else {
        const match = /Shelf\s+([A-Za-z])/i.exec(shelf.name);
        if (match !== null) {
          shelfLetter = (match[1] ?? "A").toUpperCase();
        } else {
          shelfLetter = getFirstLetter(shelf.name);
        }
      }
      const letter = getFirstLetter(chemName);
      const prefix = shelfLetter + letter;
      let num = 1;
      const existingPositions = new Set<string>();
      for (const sh of container.shelves) {
        for (const chemical of sh.chemicals) {
          if (chemical.position) {
            existingPositions.add(chemical.position);
          }
        }
      }
      while (existingPositions.has(prefix + num)) {
        num += 1;
      }
      return prefix + num;
    }
    let shelfNum = "1";
    const rangeMatch = /Shelf\s+(\d+)(?:-|\u2013)/i.exec(shelf.name);
    if (rangeMatch !== null) {
      shelfNum = rangeMatch[1] ?? "1";
    } else {
      const match = /Shelf\s+(\d+)/i.exec(shelf.name);
      if (match !== null) {
        shelfNum = match[1] ?? "1";
      } else {
        const index = container.shelves.findIndex((candidate) => candidate.id === shelf.id) + 1;
        shelfNum = String(index > 0 ? index : 1);
      }
    }
    return getFirstLetter(chemName) + shelfNum;
  }
  if (container.type === "deepfreezer" || container.type === "freezer" || container.type === "fridge") {
    return generateSequentialBoxPosition(shelf);
  }
  return generateNextPositionCode(container, chemName);
}

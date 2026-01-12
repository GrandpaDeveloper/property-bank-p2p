import type { PropertyDef, PropertyGroup } from "./types";

export const GROUP_COLORS: Record<PropertyGroup, string> = {
  brown: "#8B5A2B",
  lightblue: "#8FD3FF",
  pink: "#FF5AA5",
  orange: "#FF8A3D",
  red: "#E53935",
  yellow: "#F9D423",
  green: "#2ECC71",
  blue: "#1E3A8A",
  neutral_black: "#111827",
  neutral_gray: "#6B7280",
};

export function softBg(hex: string): string {
  return `${hex}1A`;
}

/**
 * Definición genérica estilo tablero clásico:
 * - 22 terrenos (2/3/3/3/3/3/3/2 por grupo)
 * - 4 transportes
 * - 2 servicios
 */
export const PROPERTY_DEFS: PropertyDef[] = buildDefs();

function buildDefs(): PropertyDef[] {
  const streets: Array<[PropertyGroup, number]> = [
    ["brown", 60], ["brown", 60],
    ["lightblue", 100], ["lightblue", 100], ["lightblue", 120],
    ["pink", 140], ["pink", 140], ["pink", 160],
    ["orange", 180], ["orange", 180], ["orange", 200],
    ["red", 220], ["red", 220], ["red", 240],
    ["yellow", 260], ["yellow", 260], ["yellow", 280],
    ["green", 300], ["green", 300], ["green", 320],
    ["blue", 350], ["blue", 400],
  ];

  const streetProps = streets.map(([group, price], i) => ({
    id: `P${String(i + 1).padStart(2, "0")}`,
    kind: "street" as const,
    group,
    price,
    label: `Terreno ${i + 1}`,
  }));

  const rails = [200, 200, 200, 200].map((price, i) => ({
    id: `T${i + 1}`,
    kind: "rail" as const,
    group: "neutral_black" as const,
    price,
    label: `Transporte ${i + 1}`,
  }));

  const utils = [150, 150].map((price, i) => ({
    id: `S${i + 1}`,
    kind: "utility" as const,
    group: "neutral_gray" as const,
    price,
    label: `Servicio ${i + 1}`,
  }));

  return [...streetProps, ...rails, ...utils];
}

/**
 * Costo de casa/hotel por grupo (tabla clásica).
 * (No usamos nombres, pero sí lógica de costos por color.)
 */
export const BUILD_COST_BY_GROUP: Partial<Record<PropertyGroup, number>> = {
  brown: 50,
  lightblue: 50,
  pink: 100,
  orange: 100,
  red: 150,
  yellow: 150,
  green: 200,
  blue: 200,
};

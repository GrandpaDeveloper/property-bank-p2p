import { nanoid } from "nanoid";
import { BUILD_COST_BY_GROUP, PROPERTY_DEFS } from "./properties";
import type { GameState, PlayerKey, PropertyDef, PropertyGroup, PropertyState, Tx } from "./types";

export function now(): number {
  return Date.now();
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function formatMoney(n: number): string {
  const v = clampMoney(n);
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(v);
}

export function clampMoney(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const v = Math.round(n);
  return Math.max(-9_999_999, Math.min(9_999_999, v));
}

export function makeGame(): GameState {
  const gameId = nanoid(6).toUpperCase();

  const props: Record<string, PropertyState> = {};
  for (const d of PROPERTY_DEFS) {
    props[d.id] = { id: d.id, owner: null, mortgaged: false, buildings: 0 };
  }

  return {
    gameId,
    createdAt: now(),
    startingCash: 1500,
    players: {},
    props,
    tx: [],
    bank: {
      housesAvailable: 32,
      hotelsAvailable: 12,
    },
    auctionQueue: [],
  };
}

export function addTx(state: GameState, tx: Omit<Tx, "id" | "ts">): GameState {
  const full: Tx = { id: nanoid(10), ts: now(), ...tx };
  return { ...state, tx: [full, ...state.tx] };
}

export function playerDisplay(state: GameState, key: PlayerKey | "BANK"): string {
  if (key === "BANK") return "BANCO";
  return state.players[key]?.name ?? key;
}

export function getDef(propId: string): PropertyDef | undefined {
  return PROPERTY_DEFS.find((p) => p.id === propId);
}

export function mortgageValue(propId: string): number {
  const def = getDef(propId);
  if (!def) return 0;
  // En reglas, el valor hipotecario está impreso; en tablero clásico suele ser 1/2 del precio.
  return Math.floor(def.price / 2);
}

export function groupOf(propId: string): PropertyGroup | null {
  const def = getDef(propId);
  return def ? def.group : null;
}

export function groupProps(group: PropertyGroup): string[] {
  return PROPERTY_DEFS.filter((d) => d.group === group && d.kind === "street").map((d) => d.id);
}

export function ownsFullGroup(state: GameState, owner: PlayerKey, group: PropertyGroup): boolean {
  const ids = groupProps(group);
  if (!ids.length) return false;
  return ids.every((id) => state.props[id]?.owner === owner);
}

/**
 * Regla oficial: no se pueden hipotecar propiedades mejoradas;
 * para hipotecar, primero vender TODOS los edificios del grupo al Banco (a mitad).
 */
export function canMortgage(state: GameState, propId: string): { ok: true } | { ok: false; reason: string } {
  const ps = state.props[propId];
  if (!ps) return { ok: false, reason: "Propiedad inexistente" };
  if (!ps.owner) return { ok: false, reason: "Sin dueño" };
  if (ps.mortgaged) return { ok: false, reason: "Ya está hipotecada" };

  const g = groupOf(propId);
  const def = getDef(propId);
  if (!g || !def) return { ok: false, reason: "Definición inválida" };

  if (def.kind === "street") {
    const ids = groupProps(g);
    const anyBuildings = ids.some((id) => state.props[id]?.buildings > 0);
    if (anyBuildings) {
      return { ok: false, reason: "Primero vendé todos los edificios del grupo (regla oficial)" };
    }
  } else {
    if (ps.buildings > 0) return { ok: false, reason: "No debería tener edificios" };
  }

  return { ok: true };
}

export function doMortgage(state: GameState, propId: string): GameState {
  const chk = canMortgage(state, propId);
  if (!chk.ok) return addTx(state, { type: "mortgage", from: "BANK", to: "BANK", note: `Hipoteca fallida: ${chk.reason}`, propertyId: propId });

  const ps = state.props[propId];
  const owner = ps.owner!;
  const mv = mortgageValue(propId);

  const next: GameState = {
    ...state,
    props: {
      ...state.props,
      [propId]: { ...ps, mortgaged: true },
    },
    players: {
      ...state.players,
      [owner]: { ...state.players[owner], balance: clampMoney(state.players[owner].balance + mv) },
    },
  };

  return addTx(next, {
    type: "mortgage",
    from: "BANK",
    to: owner,
    amount: mv,
    propertyId: propId,
    note: `Hipoteca (${playerDisplay(next, owner)} recibe ${formatMoney(mv)})`,
  });
}

export function canUnmortgage(state: GameState, propId: string): { ok: true; cost: number } | { ok: false; reason: string } {
  const ps = state.props[propId];
  if (!ps) return { ok: false, reason: "Propiedad inexistente" };
  if (!ps.owner) return { ok: false, reason: "Sin dueño" };
  if (!ps.mortgaged) return { ok: false, reason: "No está hipotecada" };

  const mv = mortgageValue(propId);
  const cost = mv + Math.ceil(mv * 0.1); // +10% interés (regla oficial) :contentReference[oaicite:1]{index=1}
  const owner = ps.owner;
  if (state.players[owner].balance < cost) return { ok: false, reason: "Saldo insuficiente para levantar hipoteca" };
  return { ok: true, cost };
}

export function doUnmortgage(state: GameState, propId: string): GameState {
  const chk = canUnmortgage(state, propId);
  if (!chk.ok) return addTx(state, { type: "unmortgage", from: "BANK", to: "BANK", note: `Levantar hipoteca falló: ${chk.reason}`, propertyId: propId });

  const ps = state.props[propId];
  const owner = ps.owner!;
  const cost = chk.cost;

  const next: GameState = {
    ...state,
    props: {
      ...state.props,
      [propId]: { ...ps, mortgaged: false },
    },
    players: {
      ...state.players,
      [owner]: { ...state.players[owner], balance: clampMoney(state.players[owner].balance - cost) },
    },
  };

  return addTx(next, {
    type: "unmortgage",
    from: owner,
    to: "BANK",
    amount: cost,
    propertyId: propId,
    note: `Levantar hipoteca (+10% interés)`,
  });
}

/**
 * Construcción oficial:
 * - Debe poseer grupo completo
 * - No se puede construir si algún lote del grupo está hipotecado
 * - Construir parejo (no más de 1 casa de diferencia) :contentReference[oaicite:2]{index=2}
 * - Inventario del banco (casas/hoteles)
 */
export function canBuildHouse(state: GameState, propId: string): { ok: true; cost: number } | { ok: false; reason: string } {
  const def = getDef(propId);
  const ps = state.props[propId];
  if (!def || !ps) return { ok: false, reason: "Propiedad inválida" };
  if (def.kind !== "street") return { ok: false, reason: "Solo terrenos admiten casas/hotel" };
  if (!ps.owner) return { ok: false, reason: "Sin dueño" };
  if (ps.mortgaged) return { ok: false, reason: "No se construye en hipotecada" };

  const g = def.group;
  if (!ownsFullGroup(state, ps.owner, g)) return { ok: false, reason: "Debe tener el grupo completo" };

  const ids = groupProps(g);
  const anyMortgaged = ids.some((id) => state.props[id].mortgaged);
  if (anyMortgaged) return { ok: false, reason: "No se construye si alguna del grupo está hipotecada" };

  if (ps.buildings >= 5) return { ok: false, reason: "Ya tiene hotel" };

  // Regla de construcción pareja:
  const levels = ids.map((id) => state.props[id].buildings);
  const min = Math.min(...levels);
  if (ps.buildings !== min) return { ok: false, reason: "Construcción pareja: construí primero en las más bajas" };

  if (ps.buildings === 4) {
    if (state.bank.hotelsAvailable <= 0) return { ok: false, reason: "Banco sin hoteles" };
  } else {
    if (state.bank.housesAvailable <= 0) return { ok: false, reason: "Banco sin casas" };
  }

  const cost = BUILD_COST_BY_GROUP[g] ?? 0;
  if (cost <= 0) return { ok: false, reason: "Costo no definido" };
  if (state.players[ps.owner].balance < cost) return { ok: false, reason: "Saldo insuficiente" };

  return { ok: true, cost };
}

export function doBuild(state: GameState, propId: string): GameState {
  const chk = canBuildHouse(state, propId);
  if (!chk.ok) return addTx(state, { type: "build", from: "BANK", to: "BANK", note: `Build falló: ${chk.reason}`, propertyId: propId });

  const ps = state.props[propId];
  const owner = ps.owner!;
  const cost = chk.cost;
  const nextBuildings = ps.buildings + 1;

  const bankNext = { ...state.bank };
  if (ps.buildings === 4) {
    // comprar hotel: devuelve 4 casas al banco, consume 1 hotel
    bankNext.hotelsAvailable -= 1;
    bankNext.housesAvailable += 4;
  } else {
    bankNext.housesAvailable -= 1;
  }

  const next: GameState = {
    ...state,
    bank: bankNext,
    props: {
      ...state.props,
      [propId]: { ...ps, buildings: nextBuildings },
    },
    players: {
      ...state.players,
      [owner]: { ...state.players[owner], balance: clampMoney(state.players[owner].balance - cost) },
    },
  };

  return addTx(next, {
    type: "build",
    from: owner,
    to: "BANK",
    amount: cost,
    propertyId: propId,
    note: nextBuildings === 5 ? "Compra de hotel" : "Compra de casa",
  });
}

export function canSellBuilding(state: GameState, propId: string): { ok: true; value: number } | { ok: false; reason: string } {
  const def = getDef(propId);
  const ps = state.props[propId];
  if (!def || !ps) return { ok: false, reason: "Propiedad inválida" };
  if (def.kind !== "street") return { ok: false, reason: "Solo terrenos" };
  if (!ps.owner) return { ok: false, reason: "Sin dueño" };
  if (ps.buildings <= 0) return { ok: false, reason: "No hay edificios para vender" };

  const g = def.group;
  const ids = groupProps(g);

  // Venta pareja e inversa: vender desde las más altas
  const levels = ids.map((id) => state.props[id].buildings);
  const max = Math.max(...levels);
  if (ps.buildings !== max) return { ok: false, reason: "Venta pareja: vendé primero de las más altas" };

  const cost = BUILD_COST_BY_GROUP[g] ?? 0;
  const value = Math.floor(cost / 2); // Banco compra a mitad (regla oficial) :contentReference[oaicite:3]{index=3}
  return { ok: true, value };
}

export function doSellBuilding(state: GameState, propId: string): GameState {
  const chk = canSellBuilding(state, propId);
  if (!chk.ok) return addTx(state, { type: "sell_build", from: "BANK", to: "BANK", note: `Venta falló: ${chk.reason}`, propertyId: propId });

  const ps = state.props[propId];
  const owner = ps.owner!;
  const value = chk.value;

  const bankNext = { ...state.bank };
  // Si vendés hotel, vuelve 1 hotel al banco y consume 4 casas (si se re-colocan); simplificación segura:
  if (ps.buildings === 5) {
    bankNext.hotelsAvailable += 1;
    // Para pasar de hotel -> 4 casas, la regla lo permite como “hotel = 5 casas”.
    // Mantener inventario realista completo puede ser v2; aquí lo modelamos como un paso abajo.
    bankNext.housesAvailable = Math.max(0, bankNext.housesAvailable - 4);
  } else {
    bankNext.housesAvailable += 1;
  }

  const next: GameState = {
    ...state,
    bank: bankNext,
    props: {
      ...state.props,
      [propId]: { ...ps, buildings: ps.buildings - 1 },
    },
    players: {
      ...state.players,
      [owner]: { ...state.players[owner], balance: clampMoney(state.players[owner].balance + value) },
    },
  };

  return addTx(next, {
    type: "sell_build",
    from: "BANK",
    to: owner,
    amount: value,
    propertyId: propId,
    note: "Venta de edificio (Banco paga la mitad)",
  });
}

export function transferCash(state: GameState, from: PlayerKey | "BANK", to: PlayerKey | "BANK", amount: number, note: string): GameState {
  const amt = clampMoney(amount);
  if (amt === 0) return state;

  const players = { ...state.players };
  if (from !== "BANK") {
    if (!players[from]) return state;
    players[from] = { ...players[from], balance: clampMoney(players[from].balance - amt) };
  }
  if (to !== "BANK") {
    if (!players[to]) return state;
    players[to] = { ...players[to], balance: clampMoney(players[to].balance + amt) };
  }

  const next: GameState = { ...state, players };
  return addTx(next, { type: "cash", from, to, amount: amt, note });
}

export function transferProperty(state: GameState, propId: string, to: PlayerKey | null, note: string): GameState {
  const ps = state.props[propId];
  if (!ps) return state;

  const next: GameState = {
    ...state,
    props: {
      ...state.props,
      [propId]: { ...ps, owner: to },
    },
  };

  return addTx(next, {
    type: "property_transfer",
    from: ps.owner ?? "BANK",
    to: to ?? "BANK",
    propertyId: propId,
    note,
  });
}

/**
 * Bancarrota oficial hacia jugador:
 * - Devuelve edificios al banco por mitad (cash al acreedor)
 * - Transfiere TODO lo de valor al acreedor
 * - Si hay propiedades hipotecadas: acreedor paga 10% inmediato al banco :contentReference[oaicite:4]{index=4}
 */
export function declareBankruptcyToPlayer(state: GameState, debtor: PlayerKey, creditor: PlayerKey): GameState {
  if (!state.players[debtor] || !state.players[creditor]) return state;

  let s = state;

  // 1) Vender TODOS los edificios del deudor (a mitad) y ese cash va al acreedor
  for (const def of PROPERTY_DEFS) {
    const ps = s.props[def.id];
    if (!ps || ps.owner !== debtor) continue;
    if (def.kind !== "street") continue;

    while (ps.buildings > 0) {
      // doSellBuilding paga al dueño; pero en bancarrota, ese cash va al acreedor.
      // Simplificación: vendemos, luego transferimos inmediatamente al acreedor.
      const beforeBal = s.players[debtor].balance;
      s = doSellBuilding(s, def.id);
      const afterBal = s.players[debtor].balance;
      const delta = afterBal - beforeBal;
      if (delta > 0) {
        s = transferCash(s, debtor, creditor, delta, "Liquidación por bancarrota (edificios)");
      }
      break; // evitar bucle largo en MVP (un step por propiedad). Si querés full, lo hacemos v2.
    }
  }

  // 2) Transferir todas las propiedades al acreedor
  for (const def of PROPERTY_DEFS) {
    const ps = s.props[def.id];
    if (!ps || ps.owner !== debtor) continue;

    s = transferProperty(s, def.id, creditor, "Transferencia por bancarrota");
    // Si estaba hipotecada, acreedor paga 10% inmediato al banco
    if (ps.mortgaged) {
      const mv = mortgageValue(def.id);
      const interest = Math.ceil(mv * 0.1);
      s = transferCash(s, creditor, "BANK", interest, "Interés 10% por recibir propiedad hipotecada");
    }
  }

  // 3) Transferir todo el efectivo restante del deudor al acreedor
  const cashLeft = s.players[debtor].balance;
  if (cashLeft !== 0) {
    s = transferCash(s, debtor, creditor, cashLeft, "Transferencia de efectivo por bancarrota");
  }

  // 4) Remover jugador deudor (queda retirado)
  const players = { ...s.players };
  delete players[debtor];
  s = { ...s, players };

  s = addTx(s, {
    type: "bankruptcy_player",
    from: debtor,
    to: creditor,
    note: `Bancarrota: ${playerDisplay(state, debtor)} → ${playerDisplay(state, creditor)}`,
  });

  return s;
}

/**
 * Bancarrota oficial hacia el banco:
 * - Entrega todo al banco y el banco subasta propiedades (excepto edificios) :contentReference[oaicite:5]{index=5}
 */
export function declareBankruptcyToBank(state: GameState, debtor: PlayerKey): GameState {
  if (!state.players[debtor]) return state;

  let s = state;

  // 1) vender edificios al banco (el jugador recibe cash, pero se lo queda el banco en quiebra al banco)
  // Para MVP: simplemente los eliminamos y no pagamos cash (más estricto a favor del banco).
  // Si querés exactitud total, lo ajustamos en v2.
  const propsNext = { ...s.props };
  for (const def of PROPERTY_DEFS) {
    const ps = propsNext[def.id];
    if (!ps || ps.owner !== debtor) continue;
    if (def.kind === "street" && ps.buildings > 0) {
      propsNext[def.id] = { ...ps, buildings: 0 };
    }
  }
  s = { ...s, props: propsNext };

  // 2) pasar propiedades al banco y agregarlas a auctionQueue (mortgages canceladas al pasar al banco)
  const auctionQueue = [...s.auctionQueue];
  for (const def of PROPERTY_DEFS) {
    const ps = s.props[def.id];
    if (!ps || ps.owner !== debtor) continue;

    auctionQueue.push(def.id);
    s = {
      ...s,
      props: {
        ...s.props,
        [def.id]: { ...ps, owner: null, mortgaged: false },
      },
    };
  }
  s = { ...s, auctionQueue };

  // 3) efectivo del deudor queda en banco (en práctica se usa para pagar impuestos/penalidad)
  // Para MVP: lo dejamos en 0 y retiramos jugador
  const players = { ...s.players };
  delete players[debtor];
  s = { ...s, players };

  s = addTx(s, {
    type: "bankruptcy_bank",
    from: debtor,
    to: "BANK",
    note: `Bancarrota al Banco: ${playerDisplay(state, debtor)}. Propiedades a subasta: ${auctionQueue.length}`,
  });

  return s;
}

export function auctionSellTo(state: GameState, propId: string, winner: PlayerKey, price: number): GameState {
  const ps = state.props[propId];
  if (!ps) return state;
  if (!state.players[winner]) return state;

  let s = state;

  // cobrar
  s = transferCash(s, winner, "BANK", price, "Subasta (pago al Banco)");
  // asignar propiedad sin hipoteca
  s = {
    ...s,
    props: {
      ...s.props,
      [propId]: { ...s.props[propId], owner: winner, mortgaged: false, buildings: 0 },
    },
    auctionQueue: s.auctionQueue.filter((id) => id !== propId),
  };

  s = addTx(s, {
    type: "auction",
    from: "BANK",
    to: winner,
    amount: price,
    propertyId: propId,
    note: "Subasta (asignación)",
  });

  return s;
}

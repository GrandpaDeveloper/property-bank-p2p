export type Role = "bank" | "player";

/** Conexión WebRTC específica (puede cambiar en reconexiones) */
export type ConnId = string;

/** Identidad lógica estable del jugador (por nombre normalizado) */
export type PlayerKey = string;

export type PropertyKind = "street" | "rail" | "utility";

export type PropertyGroup =
  | "brown"
  | "lightblue"
  | "pink"
  | "orange"
  | "red"
  | "yellow"
  | "green"
  | "blue"
  | "neutral_black"
  | "neutral_gray";

export type PropertyDef = {
  id: string;
  kind: PropertyKind;
  group: PropertyGroup;
  price: number;
  label: string; // genérico
};

export type PropertyState = {
  id: string;
  owner: PlayerKey | null;
  mortgaged: boolean;
  buildings: number; // 0..4 casas, 5 = hotel
};

export type Player = {
  key: PlayerKey;
  name: string;
  connId: ConnId | null;
  connected: boolean;
  balance: number;
};

export type TxType =
  | "cash"
  | "property_transfer"
  | "mortgage"
  | "unmortgage"
  | "build"
  | "sell_build"
  | "bankruptcy_player"
  | "bankruptcy_bank"
  | "auction";

export type Tx = {
  id: string;
  ts: number;
  type: TxType;
  from: string; // PlayerKey | "BANK"
  to: string; // PlayerKey | "BANK"
  note: string;
  amount?: number;
  propertyId?: string;
};

export type GameState = {
  gameId: string;
  createdAt: number;
  startingCash: number;
  players: Record<PlayerKey, Player>;
  props: Record<string, PropertyState>;
  tx: Tx[];
  // inventario del banco (regla oficial de escasez)
  bank: {
    housesAvailable: number;
    hotelsAvailable: number;
  };
  // propiedades a subastar (cuando alguien quiebra al banco)
  auctionQueue: string[];
};

export type NetMsg =
  | { t: "HELLO"; connId: ConnId; name: string }
  | { t: "STATE"; state: GameState }
  | { t: "REJECT"; reason: string }
  | { t: "REQUEST"; connId: ConnId; req: PlayerRequest };

export type PlayerRequest =
  | { k: "PAY"; toName: string; amount: number; note?: string };

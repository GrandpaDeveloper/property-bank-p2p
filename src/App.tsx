import React from "react";
import SimplePeer from "simple-peer";
import type { Instance as PeerInstance, SignalData } from "simple-peer";
import { nanoid } from "nanoid";
import { QRCodeCanvas } from "qrcode.react";
import { Scanner, type IDetectedBarcode } from "@yudiel/react-qr-scanner";

import { encodeQR, decodeQR } from "./lib/qr";
import { GROUP_COLORS, PROPERTY_DEFS, softBg } from "./lib/properties";
import {
  addTx,
  auctionSellTo,
  declareBankruptcyToBank,
  declareBankruptcyToPlayer,
  doBuild,
  doMortgage,
  doSellBuilding,
  doUnmortgage,
  formatMoney,
  makeGame,
  normalizeName,
  playerDisplay,
  transferCash,
  transferProperty,
} from "./lib/rules";

import type { ConnId, GameState, NetMsg, PlayerKey, Role } from "./lib/types";
import { Btn, Card, Divider, Input, Label, Row, Select, Textarea } from "./ui/primitives";

type Persisted = {
  role: Role;
  deviceId: string;
  lastPlayerName?: string;
  // banco: persistimos el estado para no perderlo si recarga
  bankState?: GameState;
};

const STORAGE_KEY = "propertybank.p2p.v1";

function useLocalStorageState<T>(key: string, initial: T) {
  const [value, setValue] = React.useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  }, [key, value]);
  return [value, setValue] as const;
}

function safeSend(peer: PeerInstance, msg: NetMsg) {
  try {
    peer.send(JSON.stringify(msg));
  } catch {
    // ignore
  }
}

function safeParse(data: any): any | null {
  try {
    const str = typeof data === "string" ? data : new TextDecoder().decode(data);
    return JSON.parse(str);
  } catch {
    return null;
  }
}

export default function App() {
  const [persist, setPersist] = useLocalStorageState<Persisted>(STORAGE_KEY, {
    role: "bank",
    deviceId: nanoid(10),
  });

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 px-4 pb-10 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-900/15 bg-white/70 px-4 py-3 shadow-sm">
        <div className="brand">
          <h1 className="m-0 text-sm font-black uppercase tracking-[0.2em] text-emerald-950">Property Bank</h1>
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-emerald-900/60">sin backend • QR • mobile</p>
        </div>
        <Row>
          <Btn variant={persist.role === "bank" ? "primary" : "ghost"} onClick={() => setPersist({ ...persist, role: "bank" })}>
            Banco
          </Btn>
          <Btn variant={persist.role === "player" ? "primary" : "ghost"} onClick={() => setPersist({ ...persist, role: "player" })}>
            Jugador
          </Btn>
        </Row>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {persist.role === "bank" ? (
          <BankScreen persist={persist} setPersist={setPersist} />
        ) : (
          <PlayerScreen persist={persist} setPersist={setPersist} />
        )}
      </div>

      <div className="text-xs font-semibold uppercase tracking-wide text-emerald-900/60">
        Nota: app educativa no afiliada. No usa nombres oficiales; solo lógica y colores de grupos.
      </div>
    </div>
  );
}

/* ------------------------------ BANK ------------------------------ */

type BankConn = {
  connId: ConnId;
  peer: PeerInstance;
  status: "creating" | "waiting_answer" | "connected";
  offer?: SignalData;
};

function BankScreen({ persist, setPersist }: { persist: Persisted; setPersist: (p: Persisted) => void }) {
  const [state, setState] = React.useState<GameState | null>(() => persist.bankState ?? null);
  const [conns, setConns] = React.useState<Record<string, BankConn>>({});
  const [scanOpen, setScanOpen] = React.useState(false);
  const [scanError, setScanError] = React.useState<string | null>(null);

  const [pendingJoin, setPendingJoin] = React.useState<
    Array<{ connId: ConnId; name: string; kind: "new" | "rejoin" | "duplicate" }>
  >([]);

  // Persist
  React.useEffect(() => {
    setPersist({ ...persist, bankState: state ?? undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const broadcastState = React.useCallback(
    (next: GameState) => {
      Object.values(conns).forEach((c) => {
        if (c.status === "connected") safeSend(c.peer, { t: "STATE", state: next });
      });
    },
    [conns]
  );

  const mutate = (fn: (cur: GameState) => GameState) => {
    setState((cur) => {
      if (!cur) return cur;
      const next = fn(cur);
      broadcastState(next);
      return next;
    });
  };

  const createGame = () => {
    setState(makeGame());
    // cerrar conexiones
    Object.values(conns).forEach((c) => {
      try { c.peer.destroy(); } catch {}
    });
    setConns({});
    setPendingJoin([]);
    setScanError(null);
    setScanOpen(false);
  };

  const resetAll = () => {
    setState(null);
    Object.values(conns).forEach((c) => {
      try { c.peer.destroy(); } catch {}
    });
    setConns({});
    setPendingJoin([]);
    setScanError(null);
    setScanOpen(false);
    setPersist({ role: persist.role, deviceId: persist.deviceId });
  };

  const addConnectionOffer = () => {
    if (!state) return;
    const connId = nanoid(10);

    const peer = new SimplePeer({
      initiator: true,
      trickle: false,
      config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },
    });

    const conn: BankConn = { connId, peer, status: "creating" };
    setConns((prev) => ({ ...prev, [connId]: conn }));

    peer.on("signal", (offer: SignalData) => {
      setConns((prev) => ({
        ...prev,
        [connId]: { ...prev[connId], offer, status: "waiting_answer" },
      }));
    });

    peer.on("connect", () => {
      setConns((prev) => ({ ...prev, [connId]: { ...prev[connId], status: "connected" } }));
      // empujar state actual
      setState((cur) => {
        if (!cur) return cur;
        broadcastState(cur);
        return cur;
      });
    });

    peer.on("data", (data: unknown) => {
      const msg = safeParse(data) as NetMsg | null;
      if (!msg) return;

      if (msg.t === "HELLO") {
        // jugador pide unirse o reconectar
        const name = msg.name.trim();
        const key = normalizeName(name);
        if (!name) {
          safeSend(peer, { t: "REJECT", reason: "Nombre vacío" });
          return;
        }

        setState((cur) => {
          if (!cur) return cur;

          const exists = cur.players[key];
          if (!exists) {
            // nuevo: queda pendiente hasta que el Banco acepte
            setPendingJoin((p) => [...p, { connId: msg.connId, name, kind: "new" }]);
            return cur;
          }

          if (exists.connected) {
            // nombre ya usado por un jugador conectado
            setPendingJoin((p) => [...p, { connId: msg.connId, name, kind: "duplicate" }]);
            return cur;
          }

          // existe pero estaba desconectado => rejoin
          setPendingJoin((p) => [...p, { connId: msg.connId, name, kind: "rejoin" }]);
          return cur;
        });
      }

      if (msg.t === "REQUEST") {
        // En MVP: requests solo de pago; quedan como TX “pendiente” (manual)
        // Podés evolucionarlo a un panel de aprobación.
        setState((cur) => {
          if (!cur) return cur;
          const note = `Solicitud: ${msg.req.k} (${msg.req.note ?? ""})`;
          return addTx(cur, { type: "cash", from: "BANK", to: "BANK", note });
        });
      }
    });

    peer.on("close", () => {
      setConns((prev) => {
        const copy = { ...prev };
        delete copy[connId];
        return copy;
      });
      // marcar jugador desconectado si estaba asociado
      setState((cur) => {
        if (!cur) return cur;
        const players = { ...cur.players };
        for (const k of Object.keys(players)) {
          if (players[k].connId === connId) {
            players[k] = { ...players[k], connId: null, connected: false };
          }
        }
        const next = { ...cur, players };
        broadcastState(next);
        return next;
      });
    });

    peer.on("error", (e: unknown) => console.warn("peer error", e));
  };

  const applyAnswerPayload = (payload: { kind: "ANSWER"; connId: ConnId; signal: SignalData }) => {
    const conn = conns[payload.connId];
    if (!conn) throw new Error("No existe esa conexión pendiente");
    conn.peer.signal(payload.signal);
  };

  const onScanAnswer = (text: string) => {
    try {
      setScanError(null);
      const decoded = decodeQR<{ kind: "ANSWER"; connId: ConnId; signal: SignalData }>(text);
      if (decoded.kind !== "ANSWER") throw new Error("QR no es ANSWER");
      applyAnswerPayload(decoded);
      setScanOpen(false);
    } catch (e: any) {
      setScanError(e?.message ?? "No se pudo leer QR");
    }
  };

  const acceptJoin = (req: { connId: ConnId; name: string; kind: "new" | "rejoin" | "duplicate" }, accept: boolean) => {
    setPendingJoin((p) => p.filter((x) => x !== req));

    const conn = conns[req.connId];
    if (!conn) return;

    if (!accept) {
      safeSend(conn.peer, { t: "REJECT", reason: "Rechazado por el Banco" });
      return;
    }

    mutate((cur) => {
      const key = normalizeName(req.name);
      const players = { ...cur.players };

      if (req.kind === "new") {
        players[key] = {
          key,
          name: req.name,
          connId: req.connId,
          connected: true,
          balance: cur.startingCash,
        };
        return { ...cur, players };
      }

      if (req.kind === "rejoin") {
        const old = players[key];
        if (!old) return cur;
        players[key] = { ...old, connId: req.connId, connected: true, name: req.name };
        return { ...cur, players };
      }

      // duplicate aceptado: forzamos nombre único agregando sufijo
      let unique = key;
      let n = 2;
      while (players[unique]) {
        unique = `${key} ${n}`;
        n++;
      }
      players[unique] = {
        key: unique,
        name: unique,
        connId: req.connId,
        connected: true,
        balance: cur.startingCash,
      };
      return { ...cur, players };
    });
  };

  return (
    <>
      <Card
        title="Partida"
        right={
          <Row>
            <Btn onClick={createGame} disabled={!!state}>Crear</Btn>
            <Btn variant="danger" onClick={resetAll}>Reset</Btn>
          </Row>
        }
      >
        {!state ? (
          <div style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.4 }}>
            Creá una partida en este dispositivo (Banco). Luego generás Offers por QR y los jugadores se conectan.
          </div>
        ) : (
          <>
            <Row>
              <Chip label={`Game: ${state.gameId}`} color="#111827" />
              <Chip label={`Inicial: ${formatMoney(state.startingCash)}`} color="#2ECC71" />
              <Chip label={`Jugadores: ${Object.keys(state.players).length}`} color="#1E3A8A" />
            </Row>
            <Divider />
            <Row>
              <Btn onClick={addConnectionOffer}>+ Offer (QR)</Btn>
              <Btn variant="ghost" onClick={() => setScanOpen((v) => !v)} disabled={!Object.keys(conns).length}>
                {scanOpen ? "Cerrar escáner" : "Escanear Answer"}
              </Btn>
            </Row>
          </>
        )}
      </Card>

      {scanOpen && (
        <Card title="Escanear Answer (del jugador)">
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            Permití cámara. Si falla, el jugador puede copiar/pegar el texto.
          </div>
          <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid var(--border)" }}>
            <Scanner
              onScan={(codes: IDetectedBarcode[]) => {
                const raw = codes?.[0]?.rawValue;
                if (raw) onScanAnswer(raw);
              }}
              onError={(error: unknown) => console.warn(error)}
            />
          </div>
          {scanError && <div style={{ marginTop: 10, color: "var(--danger)", fontWeight: 900 }}>{scanError}</div>}
        </Card>
      )}

      {state && <OffersPanel state={state} conns={conns} />}
      {state && pendingJoin.length > 0 && (
        <Card title={`Solicitudes de unión / reconexión (${pendingJoin.length})`}>
          <div style={{ display: "grid", gap: 10 }}>
            {pendingJoin.map((r, i) => (
              <div key={i} className={rowBlock()}>
                <div style={{ fontWeight: 900 }}>
                  {r.name}{" "}
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    ({r.kind === "new" ? "nuevo" : r.kind === "rejoin" ? "reconexión" : "nombre duplicado"})
                  </span>
                </div>
                <Row>
                  <Btn onClick={() => acceptJoin(r, true)}>Aceptar</Btn>
                  <Btn variant="ghost" onClick={() => acceptJoin(r, false)}>Rechazar</Btn>
                </Row>
              </div>
            ))}
          </div>
        </Card>
      )}

      {state && <BankPlayers state={state} mutate={mutate} />}
      {state && <BankProperties state={state} mutate={mutate} />}
      {state && <BankBuildMortgage state={state} mutate={mutate} />}
      {state && <BankBankruptcy state={state} mutate={mutate} />}
      {state && <BankAuctions state={state} mutate={mutate} />}
      {state && <Audit state={state} />}
    </>
  );
}

function OffersPanel({ state, conns }: { state: GameState; conns: Record<string, BankConn> }) {
  const list = Object.values(conns);
  if (!list.length) return null;

  return (
    <Card title="Offers (QR para conectar)">
      <div style={{ display: "grid", gap: 12 }}>
        {list.map((c) => {
          const offerPayload =
            c.offer
              ? encodeQR({ kind: "OFFER", gameId: state.gameId, connId: c.connId, signal: c.offer })
              : null;

          return (
            <div key={c.connId} className={rowBlock()}>
              <Row>
                <div style={{ fontWeight: 900 }}>Conn: {c.connId}</div>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  {c.status === "waiting_answer" ? "esperando answer" : c.status === "connected" ? "conectado" : "creando"}
                </span>
                {offerPayload && (
                  <Btn variant="ghost" onClick={() => { navigator.clipboard?.writeText(offerPayload); alert("Offer copiado"); }}>
                    Copiar
                  </Btn>
                )}
              </Row>

              {offerPayload ? (
                <div style={{ display: "grid", justifyItems: "center", gap: 8, marginTop: 10 }}>
                  <QRCodeCanvas value={offerPayload} size={220} includeMargin />
                  <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
                    El jugador escanea este QR, genera un <b>Answer</b> y lo devolvés con tu escáner.
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Generando offer…</div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function BankPlayers({ state, mutate }: { state: GameState; mutate: (fn: (s: GameState) => GameState) => void }) {
  const keys = Object.keys(state.players);

  const [from, setFrom] = React.useState<string>("BANK");
  const [to, setTo] = React.useState<string>(keys[0] ?? "BANK");
  const [amount, setAmount] = React.useState<string>("200");
  const [note, setNote] = React.useState<string>("");

  React.useEffect(() => {
    if (keys.length && to === "BANK") setTo(keys[0]);
  }, [keys, to]);

  return (
    <Card title="Transacciones (dinero)">
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "grid", gap: 8 }}>
          <Label>Desde</Label>
          <Select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="BANK">BANCO</option>
            {keys.map((k) => <option key={k} value={k}>{state.players[k].name}</option>)}
          </Select>

          <Label>Hacia</Label>
          <Select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="BANK">BANCO</option>
            {keys.map((k) => <option key={k} value={k}>{state.players[k].name}</option>)}
          </Select>

          <Label>Monto</Label>
          <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="ej: 600" />

          <Label>Motivo</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="renta, compra, impuesto..." />
        </div>

        <Row>
          <Btn
            onClick={() => {
              const amt = Number(amount);
              mutate((s) => transferCash(s, from as any, to as any, amt, note || "Transferencia"));
            }}
          >
            Ejecutar
          </Btn>
          <Btn variant="ghost" onClick={() => setAmount("10")}>10</Btn>
          <Btn variant="ghost" onClick={() => setAmount("50")}>50</Btn>
          <Btn variant="ghost" onClick={() => setAmount("100")}>100</Btn>
          <Btn variant="ghost" onClick={() => setAmount("200")}>200</Btn>
          <Btn variant="ghost" onClick={() => setAmount("500")}>500</Btn>
        </Row>

        <Divider />

        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 900 }}>Jugadores</div>
          {keys.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Todavía no hay jugadores aceptados.</div>
          ) : (
            keys.map((k) => {
              const p = state.players[k];
              return (
                <div key={k} className={rowBlock()}>
                  <Row>
                    <div style={{ fontWeight: 900 }}>{p.name}</div>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{p.connected ? "online" : "offline"}</span>
                    <div style={{ marginLeft: "auto", fontWeight: 900 }}>{formatMoney(p.balance)}</div>
                  </Row>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Card>
  );
}

function BankProperties({ state, mutate }: { state: GameState; mutate: (fn: (s: GameState) => GameState) => void }) {
  const players = Object.keys(state.players);
  const [propId, setPropId] = React.useState(PROPERTY_DEFS[0]?.id ?? "");
  const [owner, setOwner] = React.useState<string>("BANK");

  const ps = state.props[propId];
  const def = PROPERTY_DEFS.find((d) => d.id === propId);

  return (
    <Card title="Propiedades (asignar / transferir)">
      <div style={{ display: "grid", gap: 10 }}>
        <Label>Propiedad</Label>
        <Select value={propId} onChange={(e) => setPropId(e.target.value)}>
          {PROPERTY_DEFS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} • {p.id}
            </option>
          ))}
        </Select>

        <Label>Nuevo dueño</Label>
        <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="BANK">BANCO (sin dueño)</option>
          {players.map((k) => <option key={k} value={k}>{state.players[k].name}</option>)}
        </Select>

        {def && (
          <Row>
            <Chip label={`${def.kind.toUpperCase()} • ${formatMoney(def.price)}`} color={GROUP_COLORS[def.group]} />
            <Chip label={`Dueño: ${ps?.owner ? state.players[ps.owner]?.name ?? ps.owner : "BANCO"}`} color="#111827" />
            <Chip label={`Hipoteca: ${ps?.mortgaged ? "sí" : "no"}`} color={ps?.mortgaged ? "#b91c1c" : "#2ECC71"} />
            {def.kind === "street" && <Chip label={`Edificios: ${ps?.buildings ?? 0}`} color="#6B7280" />}
          </Row>
        )}

        <Row>
          <Btn onClick={() => mutate((s) => transferProperty(s, propId, owner === "BANK" ? null : (owner as PlayerKey), "Asignación"))}>
            Aplicar
          </Btn>
        </Row>

        <Divider />

        <div style={{ fontWeight: 900 }}>Vista rápida por dueño</div>
        <div style={{ display: "grid", gap: 8 }}>
          {players.map((k) => {
            const p = state.players[k];
            const owned = Object.values(state.props).filter((x) => x.owner === k).map((x) => x.id);
            return (
              <div key={k} className={rowBlock()}>
                <Row>
                  <div style={{ fontWeight: 900 }}>{p.name}</div>
                  <div style={{ marginLeft: "auto", fontWeight: 900 }}>{formatMoney(p.balance)}</div>
                </Row>
                <Row>
                  {owned.length ? (
                    owned.map((id) => {
                      const d = PROPERTY_DEFS.find((x) => x.id === id);
                      const c = d ? GROUP_COLORS[d.group] : "#6B7280";
                      const mort = state.props[id].mortgaged;
                      return (
                        <span
                          key={id}
                          title={mort ? "Hipotecada" : "Activa"}
                          style={{
                            border: `1px solid ${c}`,
                            background: softBg(c),
                            borderRadius: 999,
                            padding: "6px 10px",
                            fontSize: 12,
                            fontWeight: 900,
                            opacity: mort ? 0.65 : 1,
                          }}
                        >
                          {d?.label ?? id}{mort ? " (H)" : ""}
                        </span>
                      );
                    })
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>Sin propiedades</span>
                  )}
                </Row>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function BankBuildMortgage({ state, mutate }: { state: GameState; mutate: (fn: (s: GameState) => GameState) => void }) {
  const [propId, setPropId] = React.useState(PROPERTY_DEFS[0]?.id ?? "");
  const ps = state.props[propId];
  const def = PROPERTY_DEFS.find((d) => d.id === propId);
  const ownerName = ps?.owner ? state.players[ps.owner]?.name ?? ps.owner : "BANCO";

  return (
    <Card title="Hipotecas + Construcción (reglas oficiales)">
      <div style={{ display: "grid", gap: 10 }}>
        <Label>Propiedad</Label>
        <Select value={propId} onChange={(e) => setPropId(e.target.value)}>
          {PROPERTY_DEFS.map((p) => <option key={p.id} value={p.id}>{p.label} • {p.id}</option>)}
        </Select>

        <Row>
          <Chip label={`Dueño: ${ownerName}`} color="#111827" />
          <Chip label={`Hipotecada: ${ps?.mortgaged ? "sí" : "no"}`} color={ps?.mortgaged ? "#b91c1c" : "#2ECC71"} />
          {def?.kind === "street" && <Chip label={`Edificios: ${ps?.buildings ?? 0}`} color="#6B7280" />}
          <Chip label={`Casas: ${state.bank.housesAvailable} • Hoteles: ${state.bank.hotelsAvailable}`} color="#1E3A8A" />
        </Row>

        <Row>
          <Btn
            onClick={() => mutate((s) => doMortgage(s, propId))}
            disabled={!ps?.owner || ps.mortgaged}
          >
            Hipotecar
          </Btn>
          <Btn
            onClick={() => mutate((s) => doUnmortgage(s, propId))}
            disabled={!ps?.owner || !ps.mortgaged}
            variant="ghost"
          >
            Levantar hipoteca
          </Btn>
        </Row>

        <Divider />

        <Row>
          <Btn
            onClick={() => mutate((s) => doBuild(s, propId))}
            disabled={def?.kind !== "street" || !ps?.owner}
          >
            + Construir (casa/hotel)
          </Btn>
          <Btn
            onClick={() => mutate((s) => doSellBuilding(s, propId))}
            disabled={def?.kind !== "street" || !ps?.owner || (ps?.buildings ?? 0) <= 0}
            variant="ghost"
          >
            Vender 1 edificio
          </Btn>
        </Row>

        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>
          Reglas implementadas: construcción pareja y restricción por hipotecas; hipoteca requiere grupo sin edificios; levantar hipoteca paga principal + 10%.
        </div>
      </div>
    </Card>
  );
}

function BankBankruptcy({ state, mutate }: { state: GameState; mutate: (fn: (s: GameState) => GameState) => void }) {
  const players = Object.keys(state.players);
  const [debtor, setDebtor] = React.useState(players[0] ?? "");
  const [creditor, setCreditor] = React.useState(players[1] ?? "");
  const [mode, setMode] = React.useState<"toPlayer" | "toBank">("toPlayer");

  React.useEffect(() => {
    const p = Object.keys(state.players);
    if (p.length && !debtor) setDebtor(p[0]);
    if (p.length > 1 && !creditor) setCreditor(p[1]);
  }, [state.players, debtor, creditor]);

  return (
    <Card title="Bancarrota (asistente)">
      <div style={{ display: "grid", gap: 10 }}>
        <Row>
          <Btn variant={mode === "toPlayer" ? "primary" : "ghost"} onClick={() => setMode("toPlayer")}>
            Deuda a jugador
          </Btn>
          <Btn variant={mode === "toBank" ? "primary" : "ghost"} onClick={() => setMode("toBank")}>
            Deuda al banco
          </Btn>
        </Row>

        <Label>Deudor</Label>
        <Select value={debtor} onChange={(e) => setDebtor(e.target.value)}>
          {players.map((k) => <option key={k} value={k}>{state.players[k].name}</option>)}
        </Select>

        {mode === "toPlayer" ? (
          <>
            <Label>Acreedor</Label>
            <Select value={creditor} onChange={(e) => setCreditor(e.target.value)}>
              {players.filter((k) => k !== debtor).map((k) => <option key={k} value={k}>{state.players[k].name}</option>)}
            </Select>

            <Btn
              variant="danger"
              onClick={() => {
                if (!debtor || !creditor || debtor === creditor) return;
                if (!confirm("Confirmar bancarrota hacia jugador (transferencia total + reglas de hipoteca/edificios).")) return;
                mutate((s) => declareBankruptcyToPlayer(s, debtor as PlayerKey, creditor as PlayerKey));
              }}
              disabled={!debtor || !creditor || debtor === creditor}
            >
              Declarar bancarrota → jugador
            </Btn>
          </>
        ) : (
          <>
            <Btn
              variant="danger"
              onClick={() => {
                if (!debtor) return;
                if (!confirm("Confirmar bancarrota al Banco (propiedades pasan a subasta).")) return;
                mutate((s) => declareBankruptcyToBank(s, debtor as PlayerKey));
              }}
              disabled={!debtor}
            >
              Declarar bancarrota → Banco
            </Btn>
          </>
        )}

        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>
          Bancarrota implementa transferencia total; propiedades hipotecadas exigen 10% inmediato al banco al recibirlas.
        </div>
      </div>
    </Card>
  );
}

function BankAuctions({ state, mutate }: { state: GameState; mutate: (fn: (s: GameState) => GameState) => void }) {
  const q = state.auctionQueue;
  const players = Object.keys(state.players);

  const [propId, setPropId] = React.useState(q[0] ?? "");
  const [winner, setWinner] = React.useState(players[0] ?? "");
  const [price, setPrice] = React.useState("1");

  React.useEffect(() => {
    if (q.length && !propId) setPropId(q[0]);
  }, [q, propId]);

  if (!q.length) {
    return (
      <Card title="Subastas (cuando quiebran al Banco)">
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.4 }}>
          No hay propiedades en cola de subasta.
        </div>
      </Card>
    );
  }

  const def = PROPERTY_DEFS.find((d) => d.id === propId);

  return (
    <Card title={`Subastas (cola: ${q.length})`}>
      <div style={{ display: "grid", gap: 10 }}>
        <Label>Propiedad</Label>
        <Select value={propId} onChange={(e) => setPropId(e.target.value)}>
          {q.map((id) => {
            const d = PROPERTY_DEFS.find((x) => x.id === id);
            return <option key={id} value={id}>{d?.label ?? id} • {id}</option>;
          })}
        </Select>

        <Row>
          {def && <Chip label={`${def.label} • ${formatMoney(def.price)}`} color={GROUP_COLORS[def.group]} />}
          <Chip label="Se decide verbalmente el mejor postor; el Banco carga el resultado" color="#111827" />
        </Row>

        <Label>Ganador</Label>
        <Select value={winner} onChange={(e) => setWinner(e.target.value)}>
          {players.map((k) => <option key={k} value={k}>{state.players[k].name}</option>)}
        </Select>

        <Label>Precio</Label>
        <Input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />

        <Btn
          onClick={() => {
            const p = Number(price);
            if (!propId || !winner || !Number.isFinite(p) || p <= 0) return;
            mutate((s) => auctionSellTo(s, propId, winner as PlayerKey, p));
          }}
        >
          Cerrar subasta
        </Btn>
      </div>
    </Card>
  );
}

function Audit({ state }: { state: GameState }) {
  return (
    <Card title="Registro (auditoría simple)">
      {!state.tx.length ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>Sin movimientos todavía.</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {state.tx.slice(0, 40).map((t) => (
            <div key={t.id} className="rounded-2xl border border-emerald-900/15 bg-white/70 p-3 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-900/60">
                {new Date(t.ts).toLocaleTimeString()}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-black">
                <span>
                  {playerDisplay(state, t.from as any)} → {playerDisplay(state, t.to as any)}
                  {typeof t.amount === "number" ? `: ${formatMoney(t.amount)}` : ""}
                </span>
                {t.propertyId ? (
                  (() => {
                    const def = PROPERTY_DEFS.find((p) => p.id === t.propertyId);
                    const color = def ? GROUP_COLORS[def.group] : "#111827";
                    return <Chip label={def?.label ?? t.propertyId} color={color} />;
                  })()
                ) : null}
              </div>
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-900/60">{t.note}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------ PLAYER ------------------------------ */

function PlayerScreen({ persist, setPersist }: { persist: Persisted; setPersist: (p: Persisted) => void }) {
  const [name, setName] = React.useState(persist.lastPlayerName ?? "");
  const [offerText, setOfferText] = React.useState("");
  const [answerText, setAnswerText] = React.useState("");
  const [scanOpen, setScanOpen] = React.useState(false);
  const [scanError, setScanError] = React.useState<string | null>(null);

  const [peer, setPeer] = React.useState<PeerInstance | null>(null);
  const [connId, setConnId] = React.useState<string>("");
  const [state, setState] = React.useState<GameState | null>(null);
  const [status, setStatus] = React.useState<"idle" | "have_offer" | "show_answer" | "connected">("idle");
  const [rejected, setRejected] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPersist({ ...persist, lastPlayerName: name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const destroy = () => {
    try { peer?.destroy(); } catch {}
    setPeer(null);
    setStatus("idle");
    setOfferText("");
    setAnswerText("");
    setState(null);
    setConnId("");
    setRejected(null);
  };

  const applyOffer = (text: string) => {
    const decoded = decodeQR<{ kind: "OFFER"; gameId: string; connId: string; signal: SignalData }>(text);
    if (decoded.kind !== "OFFER") throw new Error("QR no es OFFER");

    setConnId(decoded.connId);

    const p = new SimplePeer({
      initiator: false,
      trickle: false,
      config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },
    });

    p.on("signal", (sig: SignalData) => {
      const payload = encodeQR({ kind: "ANSWER", connId: decoded.connId, signal: sig });
      setAnswerText(payload);
      setStatus("show_answer");
    });

    p.on("connect", () => {
      setStatus("connected");
      setRejected(null);
      safeSend(p, { t: "HELLO", connId: decoded.connId, name: name.trim() });
    });

    p.on("data", (data) => {
      const msg = safeParse(data) as NetMsg | null;
      if (!msg) return;

      if (msg.t === "STATE") {
        setState(msg.state);
        setRejected(null);
      }
      if (msg.t === "REJECT") {
        setRejected(msg.reason);
      }
    });

    p.on("close", () => {
      setStatus("idle");
    });

    p.on("error", (e) => console.warn("peer error", e));

    // Aplicar offer
    p.signal(decoded.signal);

    setPeer(p);
    setStatus("have_offer");
  };

  const onScanOffer = (text: string) => {
    try {
      setScanError(null);
      setOfferText(text);
      setScanOpen(false);
    } catch (e: any) {
      setScanError(e?.message ?? "No se pudo leer QR");
    }
  };

  const me = React.useMemo(() => {
    if (!state) return null;

    // Mejor manera: encontrarme por connId (aguanta duplicados / renombres)
    const byConn = Object.values(state.players).find((p) => p.connId === connId);
    if (byConn) return byConn;

    // Fallback: por nombre normalizado
    const key = normalizeName(name);
    return state.players[key] ?? null;
  }, [state, connId, name]);

  const myProps = React.useMemo(() => {
    if (!state || !me) return [];
    const owned = Object.values(state.props).filter((p) => p.owner === me.key).map((p) => p.id);
    return owned
      .map((id) => PROPERTY_DEFS.find((d) => d.id === id))
      .filter(Boolean) as typeof PROPERTY_DEFS;
  }, [state, me]);

  // Request simple al banco (opcional, no ejecuta; solo registra)
  const [reqTo, setReqTo] = React.useState<string>("");
  const [reqAmt, setReqAmt] = React.useState<string>("200");
  const [reqNote, setReqNote] = React.useState<string>("renta");

  React.useEffect(() => {
    if (state && !reqTo) {
      const others = Object.keys(state.players).filter((k) => k !== me?.key);
      setReqTo(others[0] ?? "BANK");
    }
  }, [state, me, reqTo]);

  return (
    <>
      <Card
        title="Unirse por QR (Jugador)"
        right={
          <Row>
            <Btn variant="ghost" onClick={() => setScanOpen((v) => !v)}>
              {scanOpen ? "Cerrar escáner" : "Escanear Offer"}
            </Btn>
            <Btn variant="danger" onClick={destroy}>
              Desconectar
            </Btn>
          </Row>
        }
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <Label>Tu nombre (para reconexión usá el mismo)</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Tute" />
          </div>

          {scanOpen && (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                Escaneá el QR Offer que te muestra el Banco.
              </div>
              <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid var(--border)" }}>
                <Scanner
                  onScan={(codes: IDetectedBarcode[]) => {
                    const raw = codes?.[0]?.rawValue;
                    if (raw) onScanOffer(raw);
                  }}
                  onError={(error: unknown) => console.warn(error)}
                />
              </div>
              {scanError && <div style={{ color: "var(--danger)", fontWeight: 900 }}>{scanError}</div>}
            </div>
          )}

          <div>
            <Label>Offer (pegá o escaneá)</Label>
            <Textarea value={offerText} onChange={(e) => setOfferText(e.target.value)} placeholder="Pegá aquí el Offer si no usás cámara" />
          </div>

          <Row>
            <Btn
              onClick={() => {
                setRejected(null);
                if (!name.trim()) {
                  alert("Primero poné tu nombre.");
                  return;
                }
                if (!offerText.trim()) {
                  alert("Necesitás un Offer del Banco.");
                  return;
                }
                applyOffer(offerText.trim());
              }}
            >
              Generar Answer
            </Btn>

            {answerText && (
              <Btn
                variant="ghost"
                onClick={() => {
                  navigator.clipboard?.writeText(answerText);
                  alert("Answer copiado");
                }}
              >
                Copiar Answer
              </Btn>
            )}
          </Row>

          {answerText && (
            <div style={{ display: "grid", justifyItems: "center", gap: 8 }}>
              <QRCodeCanvas value={answerText} size={220} includeMargin />
              <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
                Mostrale este QR al Banco para que escanee el <b>Answer</b>.
              </div>
            </div>
          )}

          <Divider />

          <Row>
            <Chip
              label={
                status === "connected"
                  ? "Conectado"
                  : answerText
                  ? "Answer listo (esperando al Banco)"
                  : offerText
                  ? "Offer cargado"
                  : "Listo para escanear"
              }
              color={status === "connected" ? "#2ECC71" : "#1E3A8A"}
            />
            {connId && <Chip label={`Conn: ${connId}`} color="#111827" />}
          </Row>

          {rejected && (
            <div style={{ padding: 10, borderRadius: 14, border: "1px solid rgba(185,28,28,0.35)", background: "rgba(185,28,28,0.08)" }}>
              <div style={{ fontWeight: 900, color: "var(--danger)" }}>Rechazado por el Banco</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{rejected}</div>
            </div>
          )}
        </div>
      </Card>

      <Card title="Mi estado">
        {!state ? (
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.4 }}>
            Cuando el Banco acepte tu unión y se conecten, vas a ver tu saldo y propiedades acá.
          </div>
        ) : !me ? (
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.4 }}>
            Conectado, pero todavía no estás aceptado (o tu nombre no coincide). Pedile al Banco que acepte tu solicitud.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <Row>
              <Chip label={me.name} color="#111827" />
              <Chip label={`Saldo: ${formatMoney(me.balance)}`} color="#2ECC71" />
              <Chip label={`Propiedades: ${myProps.length}`} color="#1E3A8A" />
            </Row>

            <Divider />

            <div style={{ fontWeight: 900 }}>Mis propiedades</div>
            {myProps.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--muted)" }}>Sin propiedades por ahora.</div>
            ) : (
              <Row>
                {myProps.map((d) => {
                  const c = GROUP_COLORS[d.group];
                  const ps = state.props[d.id];
                  return (
                    <span
                      key={d.id}
                      style={{
                        border: `1px solid ${c}`,
                        background: softBg(c),
                        borderRadius: 999,
                        padding: "8px 10px",
                        fontSize: 12,
                        fontWeight: 900,
                        opacity: ps.mortgaged ? 0.65 : 1,
                      }}
                      title={ps.mortgaged ? "Hipotecada" : "Activa"}
                    >
                      {d.label}
                      {ps.mortgaged ? " (H)" : ""}
                      {d.kind === "street" && ps.buildings > 0 ? ` • ${ps.buildings === 5 ? "Hotel" : `${ps.buildings}c`}` : ""}
                    </span>
                  );
                })}
              </Row>
            )}
          </div>
        )}
      </Card>

      <Card title="Otros jugadores">
        {!state ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Esperando estado…</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {Object.keys(state.players).length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--muted)" }}>No hay jugadores.</div>
            ) : (
              Object.keys(state.players).map((k) => {
                const p = state.players[k];
                const owned = Object.values(state.props).filter((x) => x.owner === k).map((x) => x.id);
                return (
                  <div key={k} className={rowBlock()}>
                    <Row>
                      <div style={{ fontWeight: 900 }}>
                        {p.name} {me?.key === k ? <span style={{ color: "var(--muted)", fontSize: 12 }}>(vos)</span> : null}
                      </div>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>{p.connected ? "online" : "offline"}</span>
                      <div style={{ marginLeft: "auto", fontWeight: 900 }}>{formatMoney(p.balance)}</div>
                    </Row>
                    <Row>
                      {owned.length ? (
                        owned.map((id) => {
                          const d = PROPERTY_DEFS.find((x) => x.id === id);
                          if (!d) return null;
                          const c = GROUP_COLORS[d.group];
                          const mort = state.props[id].mortgaged;
                          return (
                            <span
                              key={id}
                              style={{
                                border: `1px solid ${c}`,
                                background: softBg(c),
                                borderRadius: 999,
                                padding: "6px 10px",
                                fontSize: 12,
                                fontWeight: 900,
                                opacity: mort ? 0.65 : 1,
                              }}
                              title={mort ? "Hipotecada" : "Activa"}
                            >
                              {d.label}{mort ? " (H)" : ""}
                            </span>
                          );
                        })
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>Sin propiedades</span>
                      )}
                    </Row>
                  </div>
                );
              })
            )}
          </div>
        )}
      </Card>

      <Card title="Solicitud (opcional) al Banco">
        {!peer || status !== "connected" ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            Conectate primero para poder mandar solicitudes.
          </div>
        ) : !state ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Esperando estado…</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <Label>Destino</Label>
            <Select value={reqTo} onChange={(e) => setReqTo(e.target.value)}>
              <option value="BANK">BANCO</option>
              {Object.keys(state.players)
                .filter((k) => k !== me?.key)
                .map((k) => (
                  <option key={k} value={k}>
                    {state.players[k].name}
                  </option>
                ))}
            </Select>

            <Label>Monto</Label>
            <Input inputMode="numeric" value={reqAmt} onChange={(e) => setReqAmt(e.target.value)} />

            <Label>Motivo</Label>
            <Input value={reqNote} onChange={(e) => setReqNote(e.target.value)} placeholder="renta, compra, impuesto..." />

            <Btn
              onClick={() => {
                const amt = Number(reqAmt);
                if (!Number.isFinite(amt) || amt <= 0) {
                  alert("Monto inválido.");
                  return;
                }
                safeSend(peer, {
                  t: "REQUEST",
                  connId: connId,
                  req: { k: "PAY", toName: reqTo, amount: amt, note: reqNote },
                });
                alert("Solicitud enviada (el Banco la registrará).");
              }}
            >
              Enviar solicitud
            </Btn>
          </div>
        )}
      </Card>
    </>
  );
}

/* ------------------------------ Helpers UI ------------------------------ */

function rowBlock(): string {
  return "rounded-2xl border border-emerald-900/15 bg-white/70 p-3 shadow-sm";
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        border: `1px solid ${color}`,
        background: softBg(color),
        borderRadius: 999,
      }}
      className="whitespace-nowrap px-2 py-1 text-xs font-black uppercase tracking-wide text-emerald-950"
    >
      {label}
    </span>
  );
}

// src/flow.js — Agrégation semaine (un seul POST final vers n8n)
import { n8nSubmitWeek } from "./integrations/n8nClient.js";

const ORDER = ["LUNDI","MARDI","MERCREDI","JEUDI","VENDREDI","SAMEDI","DIMANCHE"];
const DAYS = new Set(ORDER);
const nextDayOf = (day) => {
  const i = ORDER.indexOf(day);
  return i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : null;
};

function normDayKey(k) {
  if (!k) return null;
  const u = k.toString().trim().toUpperCase();
  return DAYS.has(u) ? u : null;
}

function normalizeTasksByDay(input) {
  if (!input || typeof input !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    const day = normDayKey(k);
    if (!day) continue;
    if (Array.isArray(v)) {
      out[day] = v
        .filter(x => x && typeof x === "object")
        .map(x => ({ id: String(x.id), title: String(x.title) }));
    }
  }
  return out;
}

function buildDayScreen(dayId, tasks = []) {
  return { screen: dayId, data: { tasks } };
}

function buildSuccess(flow_token, week_start_iso, selections) {
  const summary_counts = Object.fromEntries(
    ORDER.map(d => [d, Array.isArray(selections?.[d]) ? selections[d].length : 0])
  );
  return {
    screen: "SUCCESS",
    data: {
      extension_message_response: {
        params: {
          flow_token,
          week_start_iso: week_start_iso || "",
          ...summary_counts
        }
      }
    }
  };
}

// Mémoire par flow_token (volatile ; pour la prod multi-instance, utilise Redis/DB)
const flowState = new Map(); // flow_token -> { tasksByDay, weekStartISO, selections, context }

export const getNextScreen = async (decryptedBody) => {
  const { screen, data, action, flow_token } = decryptedBody;

  if (action === "ping") return { data: { status: "active" } };

  // OUVERTURE (le message est envoyé le dimanche, on démarre à LUNDI)
  if (action === "INIT") {
    const inbound = data || {};
    const tasksByDay = normalizeTasksByDay(inbound.tasks_by_day || {});
    const weekStartISO = typeof inbound.week_start_iso === "string" ? inbound.week_start_iso : "";
    const context = inbound.context || null;

    flowState.set(flow_token, {
      tasksByDay,
      weekStartISO,
      selections: {}, // { LUNDI:[ids], ... }
      context
    });

    return buildDayScreen("LUNDI", tasksByDay["LUNDI"] || []);
  }

  // INTERACTIONS PAR JOUR
  if (action === "data_exchange" && DAYS.has(screen)) {
    const state = flowState.get(flow_token);
    if (!state) throw new Error("Session introuvable");

    const dayId = normDayKey(data?.day) || screen;
    const modify = Array.isArray(data?.modify_tasks) ? data.modify_tasks : [];

    // on agrège
    state.selections[dayId] = modify;

    const next = nextDayOf(dayId);
    if (!next) {
      // Fin de semaine → 1 seul POST vers n8n avec tout le package
      try {
        await n8nSubmitWeek({
          flow_token,
          week_start_iso: state.weekStartISO,
          selections: state.selections,
          tasks_by_day: state.tasksByDay,
          context: state.context
        });
      } catch (e) {
        console.warn("n8nSubmitWeek error:", e?.message);
      } finally {
        flowState.delete(flow_token);
      }

      return buildSuccess(flow_token, state.weekStartISO, state.selections);
    }

    // sinon, on affiche le jour suivant
    return buildDayScreen(next, state.tasksByDay[next] || []);
  }

  throw new Error("Requête non gérée (action/screen)");
};

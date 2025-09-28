// src/flow.js — Semaine séquentielle sans SELECT_JOUR (LUNDI→...→DIMANCHE→SUCCESS)
import { n8nSubmitResult } from "./integrations/n8nClient.js";

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

function buildSuccess(flow_token, week_start_iso, summary = {}) {
  return {
    screen: "SUCCESS",
    data: {
      // Tu peux lire ces params dans l’Extension Message si besoin
      extension_message_response: {
        params: {
          flow_token,
          week_start_iso: week_start_iso || "",
          ...summary
        }
      }
    }
  };
}

// Mémoire par flow_token (volatile)
const flowState = new Map(); // flow_token -> { tasksByDay, weekStartISO }

export const getNextScreen = async (decryptedBody) => {
  const { screen, data, action, flow_token } = decryptedBody;

  if (action === "ping") return { data: { status: "active" } };

  // OUVERTURE (toujours le dimanche côté n8n). On force le départ à LUNDI.
  if (action === "INIT") {
    // n8n pousse toute la semaine suivante :
    // data = { week_start_iso: "2025-09-29", tasks_by_day: { LUNDI:[...], ..., DIMANCHE:[...] }, ...}
    const inbound = data || {};
    const tasksByDay = normalizeTasksByDay(inbound.tasks_by_day || {});
    const weekStartISO = typeof inbound.week_start_iso === "string" ? inbound.week_start_iso : "";

    flowState.set(flow_token, { tasksByDay, weekStartISO });

    // on commence par LUNDI
    const mondayTasks = tasksByDay["LUNDI"] || [];
    return buildDayScreen("LUNDI", mondayTasks);
  }

  // INTERACTIONS UTILISATEUR (1 écran par jour)
  if (action === "data_exchange" && DAYS.has(screen)) {
    const dayId = normDayKey(data?.day) || screen;
    const modify = Array.isArray(data?.modify_tasks) ? data.modify_tasks : []; // ← CHANGEMENT ICI
    const state = flowState.get(flow_token) || { tasksByDay: {}, weekStartISO: "" };

    // Enregistrer côté n8n (même si vide = "passer")
    try {
      await n8nSubmitResult({
        flow_token,
        day: dayId,
        completed_tasks: modify, // on réutilise le champ existant côté client n8n
        raw: {
          event: "MODIFY",
          week_start_iso: state.weekStartISO,
          screen,
          data
        }
      });
    } catch (e) {
      console.warn("n8nSubmitResult error:", e?.message);
    }

    const next = nextDayOf(dayId);
    if (!next) {
      // Dernier jour (DIMANCHE) → SUCCESS
      flowState.delete(flow_token);
      return buildSuccess(flow_token, state.weekStartISO);
    }

    // Affiche le prochain jour avec ses tâches
    const nextTasks = state.tasksByDay[next] || [];
    return buildDayScreen(next, nextTasks);
  }

  throw new Error("Requête non gérée (action/screen)");
};

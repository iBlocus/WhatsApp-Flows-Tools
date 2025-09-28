// src/flow.js
import { n8nSubmitResult } from "./integrations/n8nClient.js";

const DAYS = ["LUNDI","MARDI","MERCREDI","JEUDI","VENDREDI","SAMEDI","DIMANCHE"];

// Mémoire par flow_token (volatile, suffit pour un POC)
const flowState = new Map();

function normDayKey(k) {
  if (!k) return null;
  const u = k.toString().trim().toUpperCase();
  // Autorise "Lundi"/"lundi" etc.
  if (["LUNDI","MARDI","MERCREDI","JEUDI","VENDREDI","SAMEDI","DIMANCHE"].includes(u)) return u;
  const map = { LUNDI:"LUNDI", MARDI:"MARDI", MERCREDI:"MERCREDI", JEUDI:"JEUDI", VENDREDI:"VENDREDI", SAMEDI:"SAMEDI", DIMANCHE:"DIMANCHE" };
  const cap = u.charAt(0) + u.slice(1).toLowerCase();
  return map[cap?.toUpperCase()] || null;
}

function normalizeTasksByDay(input) {
  if (!input || typeof input !== "object") return null;
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
  return Object.keys(out).length ? out : null;
}

function buildSelectJourScreen(dayOptions) {
  const opts = (dayOptions && dayOptions.length ? dayOptions : DAYS)
    .map(d => ({ id: d, title: d.charAt(0) + d.slice(1).toLowerCase() }));
  return { screen: "SELECT_JOUR", data: { day_options: opts } };
}

function buildDayScreen(dayId, tasks = []) {
  return { screen: dayId, data: { tasks } };
}

function buildSuccess(flow_token, dayId, completed = []) {
  return {
    screen: "SUCCESS",
    data: {
      extension_message_response: {
        params: {
          flow_token,
          day: dayId,
          completed_count: String(Array.isArray(completed) ? completed.length : 0)
        }
      }
    }
  };
}

export const getNextScreen = async (decryptedBody) => {
  const { screen, data, action, flow_token } = decryptedBody;

  if (action === "ping") return { data: { status: "active" } };

  if (action === "INIT") {
    // On récupère ce que n8n a poussé dans le message
    const inbound = data || {};
    let tasksByDay = normalizeTasksByDay(inbound.tasks_by_day);

    // Fallback : si n8n a envoyé seulement un jour actuel
    if (!tasksByDay && Array.isArray(inbound.tasks)) {
      const d = normDayKey(inbound.day || inbound.selected_day || inbound.default_day);
      if (d) tasksByDay = { [d]: inbound.tasks.map(x => ({ id: String(x.id), title: String(x.title) })) };
    }

    flowState.set(flow_token, { tasksByDay: tasksByDay || {} });

    const available = tasksByDay ? Object.keys(tasksByDay) : DAYS;
    return buildSelectJourScreen(available);
  }

  if (action === "data_exchange") {
    switch (screen) {
      case "SELECT_JOUR": {
        const chosen = normDayKey(data?.selected_day);
        if (!chosen) throw new Error(`Jour invalide: ${data?.selected_day}`);
        const state = flowState.get(flow_token);
        const tasks = state?.tasksByDay?.[chosen] || [];
        return buildDayScreen(chosen, tasks);
      }

      case "LUNDI":
      case "MARDI":
      case "MERCREDI":
      case "JEUDI":
      case "VENDREDI":
      case "SAMEDI":
      case "DIMANCHE": {
        const dayId = normDayKey(data?.day) || screen;
        const completed = Array.isArray(data?.completed_tasks) ? data.completed_tasks : [];

        // Envoi à n8n (réception via ton webhook)
        try {
          await n8nSubmitResult({
            flow_token,
            day: dayId,
            completed_tasks: completed,
            raw: { screen, data }
          });
        } catch (e) {
          console.warn("n8nSubmitResult error:", e?.message);
        } finally {
          // petite hygiène mémoire
          flowState.delete(flow_token);
        }

        return buildSuccess(flow_token, dayId, completed);
      }

      default:
        throw new Error(`Écran non géré: ${screen}`);
    }
  }

  throw new Error("Requête non gérée (action/screen)");
};

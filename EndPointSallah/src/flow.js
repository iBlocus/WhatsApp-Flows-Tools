// src/flow.js
import { n8nGetTasks, n8nSubmitResult } from "./integrations/n8nClient.js";

const DAYS = ["LUNDI","MARDI","MERCREDI","JEUDI","VENDREDI","SAMEDI","DIMANCHE"];

function buildSelectJourScreen(dayOptions = DAYS) {
  return {
    screen: "SELECT_JOUR",
    data: {
      day_options: dayOptions.map(d => ({ id: d, title: d.charAt(0)+d.slice(1).toLowerCase() }))
    }
  };
}

function buildDayScreen(dayId, tasks = []) {
  return {
    screen: dayId,
    data: { tasks }
  };
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

  // INIT = ouverture du flow
  if (action === "INIT") {
    // 1) Traite l'input initial fourni par ton message (optionnel)
    const initialData = data || null;

    // 2) Tente de demander à n8n un "catalogue" de tâches (par jour)
    let tasksByDay = null;
    try {
      const n8nResp = await n8nGetTasks({
        flow_token,
        screen: "INIT",
        day: null,
        initial_data: initialData
      });
      // attendu: { tasks_by_day: { LUNDI:[{id,title}], ... } } OU rien
      tasksByDay = n8nResp?.tasks_by_day || null;
    } catch (e) {
      console.warn("n8nGetTasks INIT error:", e?.message);
    }

    // 3) Si tu veux forcer le choix du jour d'abord (recommandé)
    //    tu peux aussi, si tasksByDay est déjà rempli, précharger côté SELECT_JOUR (pas indispensable).
    return buildSelectJourScreen();
  }

  if (action === "data_exchange") {
    switch (screen) {
      case "SELECT_JOUR": {
        const chosen = data?.selected_day;
        if (!DAYS.includes(chosen)) throw new Error(`Jour invalide: ${chosen}`);

        // Demande à n8n uniquement les tâches de ce jour (optionnel)
        let tasks = [];
        try {
          const n8nResp = await n8nGetTasks({
            flow_token,
            screen: "SELECT_JOUR",
            day: chosen,
            initial_data: null
          });
          // attendu: { tasks: [{id,title}, ...] } OU { tasks_by_day: {...} }
          if (Array.isArray(n8nResp?.tasks)) tasks = n8nResp.tasks;
          else if (n8nResp?.tasks_by_day?.[chosen]) tasks = n8nResp.tasks_by_day[chosen];
        } catch (e) {
          console.warn("n8nGetTasks SELECT_JOUR error:", e?.message);
        }

        return buildDayScreen(chosen, tasks);
      }

      // Tous les écrans "jour"
      case "LUNDI":
      case "MARDI":
      case "MERCREDI":
      case "JEUDI":
      case "VENDREDI":
      case "SAMEDI":
      case "DIMANCHE": {
        const dayId = data?.day || screen;
        const completed = Array.isArray(data?.completed_tasks) ? data.completed_tasks : [];

        // Envoi à n8n pour enregistrement
        try {
          await n8nSubmitResult({
            flow_token,
            day: dayId,
            completed_tasks: completed,
            raw: { screen, data } // si tu veux tout logguer côté n8n
          });
        } catch (e) {
          console.warn("n8nSubmitResult error:", e?.message);
        }

        return buildSuccess(flow_token, dayId, completed);
      }

      default:
        throw new Error(`Écran non géré: ${screen}`);
    }
  }

  throw new Error("Requête non gérée (action/screen)");
};


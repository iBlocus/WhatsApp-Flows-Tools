// src/integrations/n8nClient.js
import axios from "axios";

const { N8N_WEBHOOK_URL, N8N_API_KEY } = process.env;

function headers() {
  const h = { "Content-Type": "application/json" };
  if (N8N_API_KEY) h["x-api-key"] = N8N_API_KEY; // optionnel
  return h;
}

// (existait déjà si tu avais le mode "par jour")
// export async function n8nSubmitResult({ flow_token, day, completed_tasks, raw }) { ... }

export async function n8nSubmitWeek({ flow_token, week_start_iso, selections, tasks_by_day, context }) {
  if (!N8N_WEBHOOK_URL) return null;
  const res = await axios.post(
    N8N_WEBHOOK_URL,
    {
      event: "WEEK_SUBMIT",
      flow_token,
      week_start_iso,       // "YYYY-MM-DD" du lundi à venir
      selections,           // { LUNDI:[...], MARDI:[...], ... }
      tasks_by_day,         // echo de ce qui a été envoyé dans le message
      context               // ex: étudiant, promo, etc. si tu l’as poussé
    },
    { headers: headers(), timeout: 10000 }
  );
  return res.data || null;
}

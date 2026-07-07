import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const calendarId = 'guilhermesuzena10@gmail.com';

// Configuração do Google Auth com a Service Account
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/calendar'],
});

const calendar = google.calendar({ version: 'v3', auth });

// Configuração do Supabase Client
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Goog-Channel-ID, X-Goog-Resource-State');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Google validation ping
  const resourceState = req.headers['x-goog-resource-state'];
  if (resourceState === 'sync') {
    console.log('Google Calendar Webhook Sync Channel established.');
    return res.status(200).json({ status: 'synchronized' });
  }

  try {
    // Buscar eventos modificados nos últimos 3 minutos no Google Calendar
    const now = new Date();
    const updatedMin = new Date(now.getTime() - 3 * 60 * 1000).toISOString();

    const response = await calendar.events.list({
      calendarId,
      updatedMin,
      singleEvents: true,
      showDeleted: true,
    });

    const items = response.data.items || [];

    for (const event of items) {
      if (!event.id) continue;

      const eventId = event.id;

      if (event.status === 'cancelled') {
        // Se o evento foi excluído do Google Calendar, remova-o do Supabase
        const { error: deleteErr } = await supabase
          .from('appointments')
          .delete()
          .eq('google_event_id', eventId);

        if (deleteErr) {
          console.error(`Error deleting appointment ${eventId} from Supabase:`, deleteErr);
        } else {
          console.log(`Successfully synced deletion of event ${eventId} to Supabase.`);
        }
      } else {
        // Se o evento existe/foi modificado, atualize no Supabase
        const summary = event.summary || '';
        const summaryLower = summary.toLowerCase();
        const shared = event.extendedProperties?.shared;

        // Determinar se é um bloqueio
        const hasBlockKeyword = summaryLower.includes('folga') || 
                                summaryLower.includes('bloqueado') || 
                                summaryLower.includes('bloqueio') ||
                                summaryLower.includes('indisponível') ||
                                summaryLower.includes('indisponivel');
        const hasDashSeparator = summary.includes(' - ');
        const isBlock = shared?.type === 'block' || hasBlockKeyword || !hasDashSeparator;

        // Extrair campos de data e horário
        const startIso = event.start?.dateTime || event.start?.date;
        const endIso = event.end?.dateTime || event.end?.date;

        if (!startIso || !endIso) continue;

        const duration = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);

        let service = '';
        let name = 'Cliente Google';
        let phone = '';

        if (isBlock) {
          service = summary.replace(/^(Bloqueio - |AGENDA BLOQUEADA - )/i, '') || 'Bloqueio';
        } else {
          if (shared) {
            service = shared.service || '';
            name = shared.name || '';
            phone = shared.phone || '';
          } else {
            const parts = summary.split(' - ');
            if (parts.length >= 2) {
              service = parts.slice(0, -1).join(' - ').trim();
              name = parts[parts.length - 1].trim();
            } else {
              service = summary;
            }
          }
        }

        const appointmentData = {
          cliente_nome: isBlock ? null : name,
          cliente_telefone: isBlock ? null : phone,
          servico_nome: service,
          duracao_minutos: duration,
          data_hora_inicio: startIso,
          data_hora_fim: endIso,
          status: isBlock ? 'blocked' : (shared?.status || 'accepted'),
          google_event_id: eventId,
        };

        // Verificar se o evento já existe pelo google_event_id
        const { data: existingAppt, error: findError } = await supabase
          .from('appointments')
          .select('id')
          .eq('google_event_id', eventId)
          .maybeSingle();

        if (findError) {
          console.error(`Error querying appointment for eventId ${eventId}:`, findError);
          continue;
        }

        if (existingAppt) {
          // Atualizar
          const { error: updateErr } = await supabase
            .from('appointments')
            .update(appointmentData)
            .eq('id', existingAppt.id);

          if (updateErr) {
            console.error(`Error updating appointment ${existingAppt.id} from webhook:`, updateErr);
          } else {
            console.log(`Successfully synced update of event ${eventId} to Supabase.`);
          }
        } else {
          // Inserir novo
          const { error: insertErr } = await supabase
            .from('appointments')
            .insert({
              ...appointmentData,
              id: shared?.id || undefined, // Usa UUID original se veio do site
            });

          if (insertErr) {
            console.error(`Error inserting new appointment from webhook for event ${eventId}:`, insertErr);
          } else {
            console.log(`Successfully synced new event ${eventId} from Google to Supabase.`);
          }
        }
      }
    }

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}

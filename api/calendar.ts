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

function parseDateTimeToSaoPaulo(isoString: string) {
  try {
    const dObj = new Date(isoString);
    const formatter = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(dObj);
    const day = parts.find(p => p.type === 'day')?.value || '';
    const month = parts.find(p => p.type === 'month')?.value || '';
    const year = parts.find(p => p.type === 'year')?.value || '';
    const hour = parts.find(p => p.type === 'hour')?.value || '';
    const minute = parts.find(p => p.type === 'minute')?.value || '00';
    
    return {
      date: `${day}/${month}/${year}`,
      time: `${hour}:${minute}`
    };
  } catch (err) {
    console.error("Error parsing date-time:", err);
    return null;
  }
}

function getServicePrice(service: string): number {
  const cleanSvc = service.toLowerCase().trim();
  if (cleanSvc.includes('alongamento molde f1')) return 155;
  if (cleanSvc.includes('alongamento')) return 155;
  if (cleanSvc.includes('manutenção') || cleanSvc.includes('manutencao')) return 115;
  if (cleanSvc.includes('banho de gel')) return 90;
  if (cleanSvc.includes('esmaltação') || cleanSvc.includes('esmaltacao')) return 70;
  return 0;
}

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // ----------------------------------------------------
    // GET: Buscar eventos (agendamentos e bloqueios)
    // ----------------------------------------------------
    if (req.method === 'GET') {
      const now = new Date();
      // Período de busca padrão: de 30 dias atrás até 90 dias no futuro
      const timeMin = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
      const timeMax = new Date(now.getFullYear(), now.getMonth() + 3, 1).toISOString();

      // Consultar registros diretamente do Supabase
      const { data: dbEvents, error: dbError } = await supabase
        .from('appointments')
        .select('*')
        .neq('status', 'cancelled')
        .gte('data_hora_inicio', timeMin)
        .lte('data_hora_inicio', timeMax);

      if (dbError) {
        throw dbError;
      }

      const bookings: any[] = [];
      const blocks: any[] = [];

      for (const item of dbEvents || []) {
        const parsedStart = parseDateTimeToSaoPaulo(item.data_hora_inicio);
        const parsedEnd = parseDateTimeToSaoPaulo(item.data_hora_fim);

        if (item.status === 'blocked') {
          blocks.push({
            id: item.id,
            date: parsedStart ? parsedStart.date : '',
            allDay: item.duracao_minutos >= 1440,
            start: parsedStart ? parsedStart.time : '',
            end: parsedEnd ? parsedEnd.time : '',
            reason: item.servico_nome || 'Bloqueio',
          });
        } else {
          bookings.push({
            id: item.id,
            service: item.servico_nome || '',
            price: getServicePrice(item.servico_nome || ''),
            date: parsedStart ? parsedStart.date : '',
            time: parsedStart ? parsedStart.time : '',
            name: item.cliente_nome || '',
            phone: item.cliente_telefone || '',
            status: item.status,
          });
        }
      }

      return res.status(200).json({ bookings, blocks });
    }

    // ----------------------------------------------------
    // POST: Criar novo evento (agendamento ou bloqueio)
    // ----------------------------------------------------
    if (req.method === 'POST') {
      const { type, booking, block, duration } = req.body;

      if (type === 'booking') {
        const id = booking.id;
        const eventId = id.replace(/-/g, '').toLowerCase();

        const [d, m, y] = booking.date.split('/');
        const isoDate = `${y}-${m}-${d}`;
        const startDateTime = `${isoDate}T${booking.time}:00-03:00`;

        const startMs = new Date(startDateTime).getTime();
        const endMs = startMs + (duration || 180) * 60 * 1000;
        const endDateTime = new Date(endMs).toISOString();

        // --- CHECK DOUBLE BOOKING ON SUPABASE ---
        const dayStart = `${isoDate}T00:00:00-03:00`;
        const dayEnd = `${isoDate}T23:59:59-03:00`;

        const { data: existingEvents, error: existingErr } = await supabase
          .from('appointments')
          .select('*')
          .neq('status', 'cancelled')
          .gte('data_hora_inicio', dayStart)
          .lte('data_hora_inicio', dayEnd);

        if (existingErr) throw existingErr;

        const timeToMinutes = (t: string) => {
          const [h, mi] = t.split(':').map(Number);
          return h * 60 + mi;
        };

        const newStart = timeToMinutes(booking.time);
        const newEnd = newStart + (duration || 180);

        for (const existing of existingEvents || []) {
          if (existing.id === id) continue;

          const isBlock = existing.status === 'blocked';

          if (isBlock) {
            const allDay = existing.duracao_minutos >= 1440;
            if (allDay) {
              return res.status(409).json({ error: 'slot_occupied', message: 'Este dia está bloqueado para agendamentos.' });
            }
            const blockParsedStart = parseDateTimeToSaoPaulo(existing.data_hora_inicio);
            const blockParsedEnd = parseDateTimeToSaoPaulo(existing.data_hora_fim);
            if (blockParsedStart && blockParsedEnd) {
              const bStart = timeToMinutes(blockParsedStart.time);
              const bEnd = timeToMinutes(blockParsedEnd.time);
              if (Math.max(newStart, bStart) < Math.min(newEnd, bEnd)) {
                return res.status(409).json({ error: 'slot_occupied', message: 'Este horário está em um período bloqueado.' });
              }
            }
          } else {
            const bookingParsedStart = parseDateTimeToSaoPaulo(existing.data_hora_inicio);
            if (bookingParsedStart) {
              const bStart = timeToMinutes(bookingParsedStart.time);
              const bDuration = existing.duracao_minutos;
              const bEnd = bStart + bDuration;

              if (Math.max(newStart, bStart) < Math.min(newEnd, bEnd)) {
                return res.status(409).json({ error: 'slot_occupied', message: 'Este horário já foi agendado por outra pessoa.' });
              }
            }
          }
        }
        // --- END CHECK DOUBLE BOOKING ---

        // 1. Inserir no Supabase primeiro
        const { error: insertErr } = await supabase
          .from('appointments')
          .insert({
            id,
            cliente_nome: booking.name,
            cliente_telefone: booking.phone,
            servico_nome: booking.service,
            duracao_minutos: duration || 180,
            data_hora_inicio: startDateTime,
            data_hora_fim: endDateTime,
            status: booking.status || 'accepted',
            google_event_id: eventId
          });

        if (insertErr) throw insertErr;

        // 2. Criar evento no Google Calendar para espelhamento
        const title = `${booking.service} - ${booking.name}`;
        const description = `Cliente: ${booking.name}\nContato: ${booking.phone}\nValor: R$ ${booking.price},00`;

        await calendar.events.insert({
          calendarId,
          requestBody: {
            id: eventId,
            summary: title,
            description,
            start: { dateTime: startDateTime, timeZone: 'America/Sao_Paulo' },
            end: { dateTime: new Date(endMs).toISOString(), timeZone: 'America/Sao_Paulo' },
            extendedProperties: {
              shared: {
                id,
                type: 'booking',
                service: booking.service,
                name: booking.name,
                phone: booking.phone,
                price: String(booking.price),
                status: booking.status,
                date: booking.date,
                time: booking.time,
              },
            },
          },
        });

        return res.status(201).json({ success: true, eventId });
      }

      if (type === 'block') {
        const id = block.id;
        const eventId = id.replace(/-/g, '').toLowerCase();

        const [d, m, y] = block.date.split('/');
        const isoDate = `${y}-${m}-${d}`;

        let startDateTime: string;
        let endDateTime: string;
        let duracao = 1440;

        if (block.allDay) {
          startDateTime = `${isoDate}T00:00:00-03:00`;
          endDateTime = `${isoDate}T23:59:59-03:00`;
        } else {
          startDateTime = `${isoDate}T${block.start}:00-03:00`;
          endDateTime = `${isoDate}T${block.end}:00-03:00`;
          duracao = Math.round((new Date(endDateTime).getTime() - new Date(startDateTime).getTime()) / 60000);
        }

        // 1. Inserir no Supabase
        const { error: insertErr } = await supabase
          .from('appointments')
          .insert({
            id,
            cliente_nome: null,
            cliente_telefone: null,
            servico_nome: block.reason || 'Bloqueio',
            duracao_minutos: duracao,
            data_hora_inicio: startDateTime,
            data_hora_fim: endDateTime,
            status: 'blocked',
            google_event_id: eventId
          });

        if (insertErr) throw insertErr;

        // 2. Criar no Google Calendar
        const title = `Bloqueio - ${block.reason || 'Indisponível'}`;
        let start: any;
        let end: any;

        if (block.allDay) {
          start = { date: isoDate };
          const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
          dateObj.setDate(dateObj.getDate() + 1);
          const pad = (n: number) => String(n).padStart(2, '0');
          const nextDayStr = `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}`;
          end = { date: nextDayStr };
        } else {
          start = { dateTime: startDateTime, timeZone: 'America/Sao_Paulo' };
          end = { dateTime: endDateTime, timeZone: 'America/Sao_Paulo' };
        }

        await calendar.events.insert({
          calendarId,
          requestBody: {
            id: eventId,
            summary: title,
            description: `Bloqueio de Agenda\nMotivo: ${block.reason}`,
            start,
            end,
            extendedProperties: {
              shared: {
                id,
                type: 'block',
                reason: block.reason,
                date: block.date,
                allDay: String(block.allDay),
                start: block.start || '',
                end: block.end || '',
              },
            },
          },
        });

        return res.status(201).json({ success: true, eventId });
      }
    }

    // ----------------------------------------------------
    // PUT: Atualizar evento existente (status/detalhes)
    // ----------------------------------------------------
    if (req.method === 'PUT') {
      const { id, type, booking, block, duration } = req.body;
      const eventId = id.replace(/-/g, '').toLowerCase();

      if (type === 'booking') {
        const [d, m, y] = booking.date.split('/');
        const isoDate = `${y}-${m}-${d}`;
        const startDateTime = `${isoDate}T${booking.time}:00-03:00`;

        const startMs = new Date(startDateTime).getTime();
        const endMs = startMs + (duration || 180) * 60 * 1000;
        const endDateTime = new Date(endMs).toISOString();

        // 1. Atualizar no Supabase
        const { error: updateErr } = await supabase
          .from('appointments')
          .update({
            cliente_nome: booking.name,
            cliente_telefone: booking.phone,
            servico_nome: booking.service,
            duracao_minutos: duration || 180,
            data_hora_inicio: startDateTime,
            data_hora_fim: endDateTime,
            status: booking.status,
          })
          .eq('id', id);

        if (updateErr) throw updateErr;

        // 2. Atualizar no Google Calendar
        let suffix = '';
        if (booking.status === 'accepted') suffix = ' [Confirmado]';
        else if (booking.status === 'completed') suffix = ' [Concluído]';

        const title = `${booking.service} - ${booking.name}${suffix}`;
        const description = `Cliente: ${booking.name}\nContato: ${booking.phone}\nValor: R$ ${booking.price},00`;

        await calendar.events.update({
          calendarId,
          eventId,
          requestBody: {
            summary: title,
            description,
            start: { dateTime: startDateTime, timeZone: 'America/Sao_Paulo' },
            end: { dateTime: new Date(endMs).toISOString(), timeZone: 'America/Sao_Paulo' },
            extendedProperties: {
              shared: {
                id,
                type: 'booking',
                service: booking.service,
                name: booking.name,
                phone: booking.phone,
                price: String(booking.price),
                status: booking.status,
                date: booking.date,
                time: booking.time,
              },
            },
          },
        });

        return res.status(200).json({ success: true });
      }

      if (type === 'block') {
        const [d, m, y] = block.date.split('/');
        const isoDate = `${y}-${m}-${d}`;

        let startDateTime: string;
        let endDateTime: string;
        let duracao = 1440;

        if (block.allDay) {
          startDateTime = `${isoDate}T00:00:00-03:00`;
          endDateTime = `${isoDate}T23:59:59-03:00`;
        } else {
          startDateTime = `${isoDate}T${block.start}:00-03:00`;
          endDateTime = `${isoDate}T${block.end}:00-03:00`;
          duracao = Math.round((new Date(endDateTime).getTime() - new Date(startDateTime).getTime()) / 60000);
        }

        // 1. Atualizar no Supabase
        const { error: updateErr } = await supabase
          .from('appointments')
          .update({
            servico_nome: block.reason || 'Bloqueio',
            duracao_minutos: duracao,
            data_hora_inicio: startDateTime,
            data_hora_fim: endDateTime,
          })
          .eq('id', id);

        if (updateErr) throw updateErr;

        // 2. Atualizar no Google Calendar
        const title = `Bloqueio - ${block.reason || 'Indisponível'}`;
        let start: any;
        let end: any;

        if (block.allDay) {
          start = { date: isoDate };
          const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
          dateObj.setDate(dateObj.getDate() + 1);
          const pad = (n: number) => String(n).padStart(2, '0');
          const nextDayStr = `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}`;
          end = { date: nextDayStr };
        } else {
          start = { dateTime: startDateTime, timeZone: 'America/Sao_Paulo' };
          end = { dateTime: endDateTime, timeZone: 'America/Sao_Paulo' };
        }

        await calendar.events.update({
          calendarId,
          eventId,
          requestBody: {
            summary: title,
            description: `Bloqueio de Agenda\nMotivo: ${block.reason}`,
            start,
            end,
            extendedProperties: {
              shared: {
                id,
                type: 'block',
                reason: block.reason,
                date: block.date,
                allDay: String(block.allDay),
                start: block.start || '',
                end: block.end || '',
              },
            },
          },
        });

        return res.status(200).json({ success: true });
      }
    }

    // ----------------------------------------------------
    // DELETE: Excluir evento (agendamento ou bloqueio)
    // ----------------------------------------------------
    if (req.method === 'DELETE') {
      const id = (req.query.id as string) || req.body.id;
      if (!id) {
        return res.status(400).json({ error: 'ID is required' });
      }
      const eventId = id.replace(/-/g, '').toLowerCase();

      // 1. Excluir do Supabase
      const { error: deleteErr } = await supabase
        .from('appointments')
        .delete()
        .eq('id', id);

      if (deleteErr) throw deleteErr;

      // 2. Excluir do Google Calendar
      try {
        await calendar.events.delete({
          calendarId,
          eventId,
        });
      } catch (err: any) {
        if (err.code !== 404) {
          throw err;
        }
      }

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('Google Calendar Sync Error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}

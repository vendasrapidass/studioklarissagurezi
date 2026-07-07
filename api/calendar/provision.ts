import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

// Configuração do Google Auth com a Service Account Mestra
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email_pessoal, nome_do_estudio } = req.body;

    if (!email_pessoal || !nome_do_estudio) {
      return res.status(400).json({ error: 'Campos email_pessoal e nome_do_estudio são obrigatórios.' });
    }

    console.log(`Iniciando auto-provisionamento de agenda para o estúdio: "${nome_do_estudio}" (${email_pessoal})`);

    // 1. Criar a nova agenda secundária via Conta de Serviço
    const calendarResponse = await calendar.calendars.insert({
      requestBody: {
        summary: `Zynk - ${nome_do_estudio}`,
        timeZone: 'America/Sao_Paulo',
      },
    });

    const googleCalendarId = calendarResponse.data.id;
    if (!googleCalendarId) {
      throw new Error('Não foi possível obter o ID da agenda criada no Google.');
    }

    console.log(`Agenda criada com sucesso. ID: ${googleCalendarId}`);

    // 2. Conceder permissão de proprietária (owner) para o Gmail pessoal da dona do estúdio via ACL
    await calendar.acl.insert({
      calendarId: googleCalendarId,
      requestBody: {
        role: 'owner',
        scope: {
          type: 'user',
          value: email_pessoal,
        },
      },
    });

    console.log(`Acesso ACL de Proprietário concedido a: ${email_pessoal}`);

    // 3. Gravar o novo google_calendar_id no Supabase na tabela de configurações
    const { error: dbError } = await supabase
      .from('studio_config')
      .upsert(
        {
          nome_do_estudio,
          email_pessoal,
          google_calendar_id: googleCalendarId,
        },
        { onConflict: 'email_pessoal' }
      );

    if (dbError) {
      throw dbError;
    }

    console.log(`Agenda vinculada e persistida no Supabase com sucesso.`);

    return res.status(201).json({
      success: true,
      message: 'Agenda criada e compartilhada com sucesso!',
      google_calendar_id: googleCalendarId,
    });
  } catch (error: any) {
    console.error('Provisioning Error:', error);
    return res.status(500).json({
      error: 'Erro no provisionamento da agenda',
      message: error.message || 'Internal Server Error',
    });
  }
}

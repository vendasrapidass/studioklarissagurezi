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
    const { email_pessoal, nome_do_estudio, calendarId, createNew } = req.body;

    if (!email_pessoal) {
      return res.status(400).json({ error: 'Campo email_pessoal é obrigatório.' });
    }

    const studioName = nome_do_estudio || 'Studio Klarissa Guarezi';
    let googleCalendarId = calendarId || '24283cd68ba66c84fb7927560352d4e5d5a4e0e71526527976af2a6557c1c1ac@group.calendar.google.com';

    // 1. Criar nova agenda apenas se explicitamente solicitado
    if (createNew) {
      console.log(`Criando nova agenda para o estúdio: "${studioName}" (${email_pessoal})`);
      const calendarResponse = await calendar.calendars.insert({
        requestBody: {
          summary: `Zynk - ${studioName}`,
          timeZone: 'America/Sao_Paulo',
        },
      });

      googleCalendarId = calendarResponse.data.id;
      if (!googleCalendarId) {
        throw new Error('Não foi possível obter o ID da agenda criada no Google.');
      }
      console.log(`Agenda criada com sucesso. ID: ${googleCalendarId}`);
    }

    // 2. Conceder permissão de proprietária (owner) para o Gmail pessoal informado via ACL
    try {
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
    } catch (aclErr: any) {
      console.warn('ACL insert note:', aclErr?.message || aclErr);
      try {
        await calendar.acl.patch({
          calendarId: googleCalendarId,
          ruleId: `user:${email_pessoal}`,
          requestBody: {
            role: 'owner',
          },
        });
      } catch (patchErr) {
        console.warn('ACL patch note:', patchErr);
      }
    }

    // 3. Gravar o novo google_calendar_id no Supabase na tabela de configurações (não-bloqueante)
    try {
      await supabase
        .from('studio_config')
        .upsert(
          {
            nome_do_estudio,
            email_pessoal,
            google_calendar_id: googleCalendarId,
          },
          { onConflict: 'email_pessoal' }
        );
      console.log(`Agenda vinculada e persistida no Supabase com sucesso.`);
    } catch (dbError) {
      console.warn("Supabase provision save error (non-fatal):", dbError);
    }

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

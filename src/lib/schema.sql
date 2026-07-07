-- Script de Criação de Tabelas no Supabase para Studio Klarissa Guarezi

CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_nome TEXT NULL,
  cliente_telefone TEXT NULL,
  servico_nome TEXT NULL,
  duracao_minutos INTEGER NOT NULL,
  data_hora_inicio TIMESTAMPTZ NOT NULL,
  data_hora_fim TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted', -- 'accepted', 'completed', 'blocked', 'cancelled'
  google_event_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para buscas rápidas por faixa de horário e por ID do evento do Google Calendar
CREATE INDEX IF NOT EXISTS idx_appointments_time ON appointments (data_hora_inicio, data_hora_fim);
CREATE INDEX IF NOT EXISTS idx_appointments_google_event_id ON appointments (google_event_id);

-- Configurações de Provisionamento do Google Calendar por Estúdio
CREATE TABLE IF NOT EXISTS studio_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_do_estudio TEXT NOT NULL,
  email_pessoal TEXT NOT NULL UNIQUE,
  google_calendar_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

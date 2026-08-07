import { useState, useEffect, useMemo } from 'react';
import { Booking, SERVICES, generateWhatsAppUrl, formatPhone, ScheduleBlock, generateUUID } from '@/lib/types';
import { getBookings, saveBookings, getCompleted, saveCompleted, addCompleted, removeCompleted, addBooking, getBlocks, saveBlocks, addBlock, removeBlock } from '@/lib/bookingStore';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { CalendarDays, DollarSign, Scissors, TrendingUp, ArrowLeft, Plus, X, Check, Clock, Pencil, Trash2, Phone, Search, Settings } from 'lucide-react';

type FilterType = 'today' | 'week' | 'month' | 'year';
type TabType = 'bookings' | 'dashboard' | 'add' | 'settings';

// Safe localStorage access (fails silently in restricted webviews)
function safeLocalGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeLocalSet(key: string, val: string) {
  try { localStorage.setItem(key, val); } catch { /* noop */ }
}

const AdminPanel = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabType>('bookings');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [completed, setCompleted] = useState<Booking[]>([]);
  const [filter, setFilter] = useState<FilterType>('month');
  const [subFilter, setSubFilter] = useState<'all' | 'pending' | 'accepted' | 'completed' | 'blocks'>('accepted');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);

  // Booking list state
  const [refusingId, setRefusingId] = useState<string | null>(null);
  const [cancellingBooking, setCancellingBooking] = useState<Booking | null>(null);

  // Edit active booking state
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [editBookingDate, setEditBookingDate] = useState('');
  const [editBookingTime, setEditBookingTime] = useState('');
  const [editBookingService, setEditBookingService] = useState('');
  const [editBookingPrice, setEditBookingPrice] = useState<number>(0);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Edit completed service state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editService, setEditService] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editName, setEditName] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');

  // Manual booking form state
  const [manualService, setManualService] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [manualDate, setManualDate] = useState('');
  const [manualTime, setManualTime] = useState('');
  const [isAddingManual, setIsAddingManual] = useState(false);
  const [manualError, setManualError] = useState('');

  // Schedule block state
  const [addMode, setAddMode] = useState<'booking' | 'block'>('booking');
  const [blockDate, setBlockDate] = useState('');
  const [blockAllDay, setBlockAllDay] = useState(false);
  const [blockStart, setBlockStart] = useState('');
  const [blockEnd, setBlockEnd] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([]);
  const [isAddingBlock, setIsAddingBlock] = useState(false);

  // Settings state
  const [studioName, setStudioName] = useState('Studio Klarissa Guarezi');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [isProvisioning, setIsProvisioning] = useState(false);

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  const getBookingDuration = (serviceName: string): number => {
    if (!serviceName) return 180;
    const names = serviceName.split(' + ');
    let total = 0;
    names.forEach(name => {
      const svc = SERVICES.find(s => s.name === name.trim());
      if (svc) total += svc.time;
    });
    return total || 180;
  };

  const safeFormatDate = (dateStr: string): string => {
    // Expects DD/MM/YYYY → YYYY-MM-DD
    if (!dateStr || typeof dateStr !== 'string') return '';
    const parts = dateStr.split('/');
    if (parts.length < 3) return '';
    const [d, m, y] = parts;
    return `${y}-${m}-${d}`;
  };

  const safeDateToDisplay = (isoDate: string): string => {
    // Expects YYYY-MM-DD → DD/MM/YYYY
    if (!isoDate || typeof isoDate !== 'string') return '';
    const parts = isoDate.split('-');
    if (parts.length < 3) return isoDate;
    const [y, m, d] = parts;
    return `${d}/${m}/${y}`;
  };

  const maskDate = (raw: string): string => {
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    if (digits.length > 4) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return digits;
  };

  // ─── Load / Reload ────────────────────────────────────────────────────────────

  const reload = () => {
    // Immediate local feedback
    try {
      setBookings(getBookings());
      setCompleted(getCompleted());
      setBlocks(getBlocks());
    } catch (e) {
      console.error('Error reading local store:', e);
    }

    // Sync from Google Calendar API (best effort)
    fetch(`/api/calendar?t=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
    })
      .then(res => {
        if (!res.ok) throw new Error('API error');
        return res.json();
      })
      .then(data => {
        if (Array.isArray(data.bookings)) {
          const active = data.bookings.filter((b: Booking) => b && b.status !== 'completed');
          const done = data.bookings.filter((b: Booking) => b && b.status === 'completed');
          saveBookings(active); saveCompleted(done);
          setBookings(active); setCompleted(done);
        }
        if (Array.isArray(data.blocks)) {
          saveBlocks(data.blocks);
          setBlocks(data.blocks);
        }
      })
      .catch(err => console.error('Google Calendar sync error:', err));
  };

  useEffect(() => { reload(); }, []);

  // ─── Handlers: Calendar Provision ─────────────────────────────────────────────

  const handleProvisionCalendar = () => {
    setIsProvisioning(true);
    fetch('/api/calendar/provision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email_pessoal: ownerEmail, nome_do_estudio: studioName }),
    })
      .then(async res => {
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw e; }
        return res.json();
      })
      .then(() => {
        toast.success('Agenda criada! Peça para aceitar o convite no e-mail.');
        setIsProvisioning(false);
      })
      .catch(err => {
        console.error('Provision error:', err);
        toast.error(err?.message || 'Erro ao criar a agenda. Tente novamente.');
        setIsProvisioning(false);
      });
  };

  // ─── Handlers: Accept / Finalize / Refuse / Cancel ────────────────────────────

  const handleAccept = (booking: Booking) => {
    if (!booking) return;
    const msg = `✨ *STUDIO KLARISSA GUAREZI* ✨\n\nOlá *${booking.name}*! 👋\n\nSeu agendamento foi *CONFIRMADO* com sucesso! ✅\n\n📋 *Serviço:* ${booking.service}\n💰 *Valor:* R$ ${booking.price},00\n📅 *Data:* ${booking.date}\n🕐 *Horário:* ${booking.time}\n\n📍 *Endereço:* Edifício Ilha de Manhattan - Av. Vereador Arlindo Chemin, nº 50, Sala 102 (Piso 1, à esquerda) - Centro, Campo Largo - PR\n\nEstamos te esperando! 🌸\nAté lá! 🤝`;
    if (booking.phone) { try { window.open(generateWhatsAppUrl(booking.phone, msg), '_blank'); } catch (e) { /* noop */ } }
    const updated = bookings.map(b => b.id === booking.id ? { ...booking, status: 'accepted' as const } : b);
    saveBookings(updated); setBookings(updated);
    fetch('/api/calendar', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: booking.id, type: 'booking', booking: { ...booking, status: 'accepted' }, duration: getBookingDuration(booking.service) }),
    }).then(r => { if (!r.ok) throw new Error(); reload(); }).catch(e => console.error('Accept sync error:', e));
  };

  const handleFinalize = (booking: Booking) => {
    if (!booking) return;
    addCompleted(booking);
    const updated = bookings.filter(b => b.id !== booking.id);
    saveBookings(updated); setBookings(updated); setCompleted(getCompleted());
    const done = { ...booking, status: 'completed' as const };
    fetch('/api/calendar', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: booking.id, type: 'booking', booking: done, duration: getBookingDuration(booking.service) }),
    }).then(r => { if (!r.ok) throw new Error(); reload(); }).catch(e => console.error('Finalize sync error:', e));
  };

  const handleRefuse = (booking: Booking, reason: string) => {
    if (!booking) return;
    const msg = `✨ *STUDIO KLARISSA GUAREZI* ✨\n\nOlá *${booking.name}*! 👋\n\nInfelizmente não poderemos atender seu agendamento. 😔\n\n📋 *Serviço:* ${booking.service}\n📅 *Data:* ${booking.date}\n🕐 *Horário:* ${booking.time}\n\n❌ *Motivo:* ${reason}\n\nPor favor, escolha outro horário disponível no nosso site. Desculpe pelo inconveniente! 🙏\n\nEstamos à disposição! 🌸`;
    if (booking.phone) { try { window.open(generateWhatsAppUrl(booking.phone, msg), '_blank'); } catch (e) { /* noop */ } }
    const updated = bookings.filter(b => b.id !== booking.id);
    saveBookings(updated); setBookings(updated); setRefusingId(null);
    fetch(`/api/calendar?id=${booking.id}`, { method: 'DELETE' })
      .then(r => { if (!r.ok) throw new Error(); reload(); })
      .catch(e => console.error('Refuse sync error:', e));
  };

  const handleCancelBooking = (booking: Booking) => { if (booking) setCancellingBooking(booking); };

  const handleConfirmCancel = () => {
    if (!cancellingBooking) return;
    const booking = cancellingBooking;
    const updated = bookings.filter(b => b.id !== booking.id);
    saveBookings(updated); setBookings(updated); setCancellingBooking(null);
    fetch(`/api/calendar?id=${booking.id}`, { method: 'DELETE' })
      .then(r => { if (!r.ok) throw new Error(); toast.success('Agendamento cancelado!'); reload(); })
      .catch(e => { console.error('Cancel sync error:', e); toast.error('Erro ao cancelar.'); });
  };

  // ─── Handlers: Edit Completed ─────────────────────────────────────────────────

  const handleDeleteCompleted = (id: string) => {
    try { removeCompleted(id); setCompleted(getCompleted()); } catch (e) { console.error(e); }
  };

  const startEdit = (b: Booking) => {
    if (!b) return;
    setEditingId(b.id); setEditService(b.service || ''); setEditPrice(String(b.price || 0));
    setEditName(b.name || ''); setEditDate(b.date || ''); setEditTime(b.time || '');
  };

  const saveEdit = () => {
    if (!editingId) return;
    const updated = completed.map(b =>
      b.id === editingId ? { ...b, service: editService, price: Number(editPrice) || 0, name: editName, date: editDate, time: editTime } : b
    );
    saveCompleted(updated); setCompleted(updated); setEditingId(null);
  };

  // ─── Handlers: Edit Active Booking ───────────────────────────────────────────

  const startEditBooking = (b: Booking) => {
    if (!b) return;
    setEditingBooking(b);
    setEditBookingDate(safeFormatDate(b.date || ''));
    setEditBookingTime(b.time || '');
    setEditBookingService(b.service || '');
    setEditBookingPrice(b.price || 0);
  };

  const handleServiceChange = (serviceName: string) => {
    setEditBookingService(serviceName);
    const svc = SERVICES.find(s => s.name === serviceName);
    if (svc) {
      setEditBookingPrice(svc.price);
      setEditingBooking(prev => prev ? { ...prev, service: serviceName, price: svc.price } : null);
    }
  };

  const handleSaveEditBooking = () => {
    if (!editingBooking || !editBookingService || !editBookingDate || !editBookingTime) return;
    setIsSavingEdit(true);
    const formattedDate = safeDateToDisplay(editBookingDate);
    if (!formattedDate) { setIsSavingEdit(false); return; }
    const updatedBooking: Booking = { ...editingBooking, service: editBookingService, price: editBookingPrice, date: formattedDate, time: editBookingTime };
    fetch('/api/calendar', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editingBooking.id, type: 'booking', booking: updatedBooking, duration: getBookingDuration(updatedBooking.service) }),
    })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(() => {
        const updated = bookings.map(b => b.id === editingBooking.id ? updatedBooking : b);
        saveBookings(updated); setBookings(updated);
        setEditingBooking(null); setIsSavingEdit(false);
        toast.success('Agendamento editado com sucesso!'); reload();
      })
      .catch(err => { console.error('Edit booking error:', err); toast.error('Erro ao salvar alterações.'); setIsSavingEdit(false); });
  };

  // ─── Handlers: Manual Add ─────────────────────────────────────────────────────

  const handleSelectService = (name: string) => {
    setManualService(name);
    const svc = SERVICES.find(s => s.name === name);
    if (svc) setManualPrice(String(svc.price));
  };

  const handleAddManualService = () => {
    setManualError('');
    if (!manualService.trim()) { setManualError('Selecione ou digite o nome do serviço.'); return; }
    if (!manualPrice) { setManualError('Informe o valor do serviço.'); return; }
    if (!manualName.trim()) { setManualError('Informe o nome da cliente.'); return; }
    if (!manualDate || manualDate.length < 10) { setManualError('Informe a data completa no formato DD/MM/AAAA.'); return; }
    if (!manualTime) { setManualError('Informe o horário do agendamento.'); return; }

    setIsAddingManual(true);

    const booking: Booking = {
      id: generateUUID(),
      service: manualService.trim(),
      price: Number(manualPrice) || 0,
      date: manualDate,
      time: manualTime,
      name: manualName.trim(),
      phone: manualPhone.replace(/\D/g, ''),
      status: 'accepted',
    };

    try { addBooking(booking); } catch (e) { console.error('Local store error:', e); }

    const svc = SERVICES.find(s => s.name === manualService);
    const duration = svc ? svc.time : 180;

    fetch('/api/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'booking', booking, duration }),
    })
      .then(r => { if (!r.ok) throw new Error('API error'); reload(); })
      .catch(e => console.error('Manual booking calendar sync error:', e))
      .finally(() => {
        setIsAddingManual(false);
        setManualService(''); setManualPrice(''); setManualName('');
        setManualPhone(''); setManualDate(''); setManualTime('');
        setManualError('');
        setShowSuccess(true);
        setTab('bookings');
        setTimeout(() => setShowSuccess(false), 2500);
      });
  };

  // ─── Handlers: Schedule Block ─────────────────────────────────────────────────

  const handleSaveBlock = () => {
    if (!blockDate || blockDate.length < 10) { toast.error('Informe a data completa no formato DD/MM/AAAA.'); return; }
    if (!blockAllDay && (!blockStart || !blockEnd)) { toast.error('Informe os horários de início e término.'); return; }

    setIsAddingBlock(true);

    const block: ScheduleBlock = {
      id: generateUUID(),
      date: blockDate,
      allDay: blockAllDay,
      start: blockAllDay ? undefined : blockStart,
      end: blockAllDay ? undefined : blockEnd,
      reason: blockReason.trim() || 'Bloqueio de Agenda',
    };

    try { addBlock(block); } catch (e) { console.error('Local store error:', e); }

    fetch('/api/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'block', block }),
    })
      .then(r => { if (!r.ok) throw new Error('API error'); reload(); })
      .catch(e => console.error('Block calendar sync error:', e))
      .finally(() => {
        setIsAddingBlock(false);
        setBlockDate(''); setBlockAllDay(false); setBlockStart('');
        setBlockEnd(''); setBlockReason('');
        toast.success('Bloqueio salvo!');
        reload();
      });
  };

  const handleDeleteBlock = (id: string) => {
    try { removeBlock(id); setBlocks(getBlocks()); } catch (e) { console.error(e); }
    fetch(`/api/calendar?id=${id}&type=block`, { method: 'DELETE' })
      .then(r => { if (!r.ok) throw new Error(); reload(); })
      .catch(e => console.error('Delete block error:', e));
  };

  // ─── Computed Values ──────────────────────────────────────────────────────────

  const filteredCompleted = useMemo(() => {
    const now = new Date();
    return completed.filter(b => {
      if (!b || !b.date || typeof b.date !== 'string') return false;
      const parts = b.date.split('/');
      if (parts.length < 3) return false;
      const [d, m, y] = parts.map(Number);
      if (isNaN(d) || isNaN(m) || isNaN(y)) return false;
      const date = new Date(y, m - 1, d);
      switch (filter) {
        case 'today': return date.toDateString() === now.toDateString();
        case 'week': { const wa = new Date(now); wa.setDate(wa.getDate() - 7); return date >= wa; }
        case 'month': return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
        case 'year': return date.getFullYear() === now.getFullYear();
        default: return true;
      }
    });
  }, [completed, filter]);

  const totalRevenue = filteredCompleted.reduce((sum, b) => sum + (b.price || 0), 0);
  const totalServices = filteredCompleted.length;
  const pendingCount = bookings.filter(b => b && b.status === 'pending').length;
  const acceptedCount = bookings.filter(b => b && b.status === 'accepted').length;

  const unifiedAgenda = useMemo(() => {
    type AgendaItem =
      | { type: 'booking'; id: string; timestamp: number; raw: Booking }
      | { type: 'block'; id: string; timestamp: number; raw: ScheduleBlock };

    const items: AgendaItem[] = [];
    const listBookings = subFilter === 'completed' ? completed : bookings;

    listBookings.forEach(b => {
      if (!b) return;
      if (subFilter !== 'all' && subFilter !== 'completed' && b.status !== subFilter) return;
      let timestamp = 0;
      try {
        const parts = (b.date || '').split('/');
        if (parts.length >= 3) {
          const [d, m, y] = parts.map(Number);
          const tParts = (b.time || '00:00').split(':');
          const [h, min] = tParts.length >= 2 ? tParts.map(Number) : [0, 0];
          timestamp = new Date(y, m - 1, d, h, min).getTime() || 0;
        }
      } catch { timestamp = 0; }
      items.push({ type: 'booking', id: b.id || generateUUID(), timestamp, raw: b });
    });

    if (subFilter === 'all' || subFilter === 'blocks') {
      blocks.forEach(bl => {
        if (!bl) return;
        let timestamp = 0;
        try {
          const parts = (bl.date || '').split('/');
          if (parts.length >= 3) {
            const [d, m, y] = parts.map(Number);
            let h = 0, min = 0;
            if (!bl.allDay && bl.start) {
              const sp = bl.start.split(':');
              if (sp.length >= 2) { h = Number(sp[0]); min = Number(sp[1]); }
            }
            timestamp = new Date(y, m - 1, d, h, min).getTime() || 0;
          }
        } catch { timestamp = 0; }
        items.push({ type: 'block', id: bl.id || generateUUID(), timestamp, raw: bl });
      });
    }

    return items.sort((a, b) => subFilter === 'completed' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp);
  }, [bookings, blocks, completed, subFilter]);

  const filteredAgenda = useMemo(() => {
    let items = unifiedAgenda;
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      items = items.filter(item => {
        if (!item?.raw) return false;
        if (item.type === 'booking') {
          const b = item.raw;
          return (b.name || '').toLowerCase().includes(q) || (b.service || '').toLowerCase().includes(q) || (b.phone || '').toLowerCase().includes(q);
        }
        return (item.raw.reason || '').toLowerCase().includes(q);
      });
    }
    if (filterDate) {
      const parts = filterDate.split('-');
      if (parts.length >= 3) {
        const formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
        items = items.filter(item => item.raw?.date === formattedDate);
      }
    }
    return items;
  }, [unifiedAgenda, searchTerm, filterDate]);

  const tabs = [
    { key: 'bookings' as TabType, label: 'Agendamentos', icon: <CalendarDays className="w-4 h-4" />, badge: bookings.length + blocks.length },
    { key: 'dashboard' as TabType, label: 'Dashboard', icon: <TrendingUp className="w-4 h-4" /> },
    { key: 'add' as TabType, label: 'Adicionar', icon: <Plus className="w-4 h-4" /> },
    { key: 'settings' as TabType, label: 'Configurações', icon: <Settings className="w-4 h-4" /> },
  ];

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="p-4 md:p-6 border-b border-primary/10 flex justify-between items-center bg-card/50 backdrop-blur-xl sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Scissors className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Painel de Controle</h2>
              <p className="text-xs text-muted-foreground">Studio Klarissa Guarezi</p>
            </div>
          </div>
          <button onClick={() => navigate('/')} className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors text-sm">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </button>
        </div>

        {/* Tabs Nav */}
        <div className="flex border-b border-primary/10 sticky top-[68px] md:top-[76px] bg-background/80 backdrop-blur-xl z-10">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition-all relative ${tab === t.key ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {t.icon}
              <span className="hidden sm:inline">{t.label}</span>
              {t.badge !== undefined && t.badge > 0 && (
                <span className="bg-primary text-primary-foreground text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">{t.badge}</span>
              )}
              {tab === t.key && <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-primary rounded-full" />}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-4 md:p-8">

          {/* ── BOOKINGS TAB ── */}
          {tab === 'bookings' && (
            <div className="space-y-4">
              {showSuccess && (
                <div className="p-4 bg-primary/10 border border-primary/20 rounded-xl flex items-center gap-3 text-primary text-sm font-medium">
                  <Check className="w-5 h-5" /> Serviço adicionado aos agendamentos!
                </div>
              )}

              {/* Sub-filter tabs */}
              <div className="flex gap-2 flex-wrap pb-3 border-b border-primary/5">
                {([
                  { key: 'accepted', label: 'Todos', count: acceptedCount, color: 'text-emerald-400' },
                  { key: 'completed', label: 'Concluídos', count: completed.length, color: 'text-primary' },
                  { key: 'blocks', label: 'Bloqueios', count: blocks.length, color: 'text-destructive' }
                ] as const).map(sf => (
                  <button
                    key={sf.key}
                    onClick={() => setSubFilter(sf.key)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold border transition-all ${subFilter === sf.key ? 'bg-primary text-primary-foreground border-primary shadow-[0_0_15px_-3px_hsl(6_48%_68%/0.3)]' : 'bg-card/40 text-muted-foreground hover:text-foreground border-primary/10'}`}
                  >
                    <span className={subFilter === sf.key ? 'text-primary-foreground' : sf.color}>{sf.label}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${subFilter === sf.key ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>{sf.count}</span>
                  </button>
                ))}
              </div>

              {/* Search & Date Filter */}
              <div className="flex items-center bg-card/50 backdrop-blur-sm border border-primary/10 rounded-xl px-3 h-10 w-full text-xs gap-2 relative overflow-hidden">
                <div className="flex items-center gap-2 flex-1 h-full min-w-0">
                  <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Pesquisar..."
                    className="bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/40 w-full h-full text-xs min-w-0"
                  />
                </div>
                {(searchTerm || filterDate) && (
                  <button onClick={() => { setSearchTerm(''); setFilterDate(''); }} className="p-3 -ml-2 text-muted-foreground/60 hover:text-foreground transition-colors flex-shrink-0 cursor-pointer z-20 relative">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <div className="h-4 w-px bg-primary/10 flex-shrink-0" />
                <div className="relative flex items-center justify-center h-full px-1.5 gap-1.5 cursor-pointer hover:bg-primary/5 rounded-lg transition-colors flex-shrink-0">
                  <CalendarDays className="w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  {filterDate ? (
                    <span className="text-[10px] font-mono text-primary font-bold pointer-events-none">
                      {(() => { const p = filterDate.split('-'); return p.length >= 3 ? `${p[2]}/${p[1]}` : filterDate; })()}
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground hidden sm:inline pointer-events-none">Data</span>
                  )}
                  <input
                    type="date"
                    value={filterDate}
                    onChange={e => setFilterDate(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                    style={{ colorScheme: 'dark' }}
                  />
                </div>
              </div>

              {/* Empty state */}
              {filteredAgenda.length === 0 && (
                <div className="text-center py-16">
                  <CalendarDays className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
                  <p className="text-muted-foreground text-sm">
                    {searchTerm || filterDate ? 'Nenhum agendamento encontrado.' : (
                      subFilter === 'accepted' ? 'Nenhum agendamento confirmado' :
                      subFilter === 'completed' ? 'Nenhum agendamento concluído no histórico' :
                      'Nenhum horário bloqueado'
                    )}
                  </p>
                </div>
              )}

              {/* Agenda List */}
              <div className="space-y-3">
                {filteredAgenda.map(item => {
                  if (!item?.raw) return null;

                  if (item.type === 'booking') {
                    const a = item.raw;
                    return (
                      <div key={a.id} className={`p-5 md:p-6 bg-card/60 backdrop-blur-sm rounded-2xl border transition-all ${a.status === 'completed' ? 'border-primary/10 opacity-70' : a.status === 'accepted' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-primary/10 hover:border-primary/20'}`}>
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-bold text-lg text-foreground">{a.name}</p>
                              {a.status === 'completed' && <span className="text-[10px] bg-primary/20 text-primary px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Concluído</span>}
                              {a.status === 'accepted' && <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Confirmado</span>}
                              {a.status === 'pending' && <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Aguardando</span>}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <span className="inline-flex items-center gap-1.5 text-xs bg-primary/10 text-primary px-2.5 py-1 rounded-full font-medium"><Scissors className="w-3 h-3" /> {a.service}</span>
                              <span className="inline-flex items-center gap-1.5 text-xs bg-secondary text-muted-foreground px-2.5 py-1 rounded-full"><CalendarDays className="w-3 h-3" /> {a.date} às {a.time}</span>
                            </div>
                            {a.phone && <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3" /> {a.phone}</p>}
                            <p className="text-lg font-mono font-bold text-primary mt-1">R$ {a.price},00</p>
                          </div>
                          <div className="flex gap-2 flex-shrink-0 flex-wrap">
                            {a.status === 'completed' ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs bg-primary/10 text-primary px-3 py-1.5 rounded-full font-bold uppercase tracking-wider">✓ Concluído</span>
                                <button onClick={() => handleDeleteCompleted(a.id)} className="px-3 py-2 bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/20 rounded-xl text-xs font-bold transition-all" title="Remover">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex gap-2 flex-wrap">
                                <button onClick={() => handleFinalize(a)} className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-bold transition-all hover:scale-105 active:scale-95 flex items-center gap-1.5">
                                  <Check className="w-3.5 h-3.5" /> Finalizar
                                </button>
                                <button onClick={() => handleCancelBooking(a)} className="px-4 py-2 bg-destructive/10 text-destructive border border-destructive/20 rounded-xl text-xs font-bold transition-all hover:bg-destructive hover:text-destructive-foreground flex items-center gap-1.5">
                                  <X className="w-3.5 h-3.5" /> Cancelar
                                </button>
                                <button onClick={() => startEditBooking(a)} className="px-3.5 py-2 bg-transparent text-muted-foreground/60 border border-primary/5 hover:border-primary/20 hover:text-foreground rounded-xl text-xs font-bold transition-all flex items-center gap-1.5">
                                  <Pencil className="w-3.5 h-3.5" /> Editar
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Refuse panel */}
                        {refusingId === a.id && (
                          <div className="mt-4 pt-4 border-t border-primary/10 space-y-3">
                            <p className="text-sm text-muted-foreground font-medium">Motivo da recusa:</p>
                            <div className="flex flex-wrap gap-2">
                              {['Imprevisto', 'Indisponibilidade', 'Problema pessoal', 'Horário não disponível'].map(reason => (
                                <button key={reason} onClick={() => handleRefuse(a, reason)} className="px-3 py-1.5 bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive hover:text-destructive-foreground rounded-lg text-xs font-medium transition-all">
                                  {reason}
                                </button>
                              ))}
                            </div>
                            <button onClick={() => setRefusingId(null)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Cancelar</button>
                          </div>
                        )}
                      </div>
                    );
                  } else {
                    const bl = item.raw;
                    return (
                      <div key={bl.id} className="p-5 md:p-6 bg-destructive/5 backdrop-blur-sm rounded-2xl border border-destructive/20 hover:border-destructive/30 transition-all">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-lg text-foreground">AGENDA BLOQUEADA</p>
                              <span className="text-[10px] bg-destructive/20 text-destructive px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Bloqueio</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <span className="inline-flex items-center gap-1.5 text-xs bg-primary/10 text-primary px-2.5 py-1 rounded-full font-medium">Motivo: {bl.reason}</span>
                              <span className="inline-flex items-center gap-1.5 text-xs bg-secondary text-muted-foreground px-2.5 py-1 rounded-full"><CalendarDays className="w-3 h-3" /> {bl.date} {bl.allDay ? '(Dia Inteiro)' : `das ${bl.start} às ${bl.end}`}</span>
                            </div>
                          </div>
                          <button onClick={() => handleDeleteBlock(bl.id)} className="px-4 py-2 bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/20 rounded-xl text-sm font-bold transition-all flex items-center gap-1.5">
                            <Trash2 className="w-4 h-4" /> Remover Bloqueio
                          </button>
                        </div>
                      </div>
                    );
                  }
                })}
              </div>
            </div>
          )}

          {/* ── DASHBOARD TAB ── */}
          {tab === 'dashboard' && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-6 bg-card/60 backdrop-blur-sm rounded-2xl border border-primary/10 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><DollarSign className="w-5 h-5 text-primary" /></div>
                    <p className="text-xs uppercase tracking-widest text-muted-foreground">Faturamento</p>
                  </div>
                  <p className="text-3xl md:text-4xl font-mono font-bold text-foreground">R$ <span className="text-primary">{totalRevenue}</span></p>
                </div>
                <div className="p-6 bg-card/60 backdrop-blur-sm rounded-2xl border border-primary/10 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Scissors className="w-5 h-5 text-primary" /></div>
                    <p className="text-xs uppercase tracking-widest text-muted-foreground">Serviços</p>
                  </div>
                  <p className="text-3xl md:text-4xl font-mono font-bold text-foreground"><span className="text-primary">{totalServices}</span></p>
                </div>
              </div>

              <div className="flex gap-2 flex-wrap">
                {([['today', 'Hoje'], ['week', 'Semana'], ['month', 'Mês'], ['year', 'Ano']] as const).map(([key, label]) => (
                  <button key={key} onClick={() => setFilter(key)} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${filter === key ? 'bg-primary text-primary-foreground shadow-[0_0_15px_-3px_hsl(45_97%_54%/0.4)]' : 'bg-card/60 text-muted-foreground hover:text-foreground border border-primary/10'}`}>{label}</button>
                ))}
              </div>

              <div className="bg-card/60 backdrop-blur-sm rounded-2xl border border-primary/10 p-6">
                <h3 className="font-bold mb-5 text-foreground flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" /> Faturamento por Serviço</h3>
                {(() => {
                  const grouped: Record<string, number> = {};
                  filteredCompleted.forEach(b => { if (b?.service) grouped[b.service] = (grouped[b.service] || 0) + (b.price || 0); });
                  const max = Math.max(...Object.values(grouped), 1);
                  return Object.entries(grouped).length === 0 ? (
                    <p className="text-muted-foreground text-sm">Nenhum serviço concluído neste período.</p>
                  ) : (
                    <div className="space-y-4">
                      {Object.entries(grouped).sort(([, a], [, b]) => b - a).map(([service, total]) => (
                        <div key={service}>
                          <div className="flex justify-between text-sm mb-1.5"><span className="text-foreground">{service}</span><span className="font-mono font-bold text-primary">R$ {total}</span></div>
                          <div className="w-full bg-secondary/50 rounded-full h-2.5 overflow-hidden">
                            <div className="bg-gradient-to-r from-primary/80 to-primary h-2.5 rounded-full transition-all duration-700" style={{ width: `${(total / max) * 100}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              <div>
                <h3 className="font-bold text-foreground mb-4 flex items-center gap-2"><Clock className="w-4 h-4 text-primary" /> Histórico ({filteredCompleted.length})</h3>
                <div className="space-y-3">
                  {filteredCompleted.length === 0 && (
                    <div className="text-center py-12"><Scissors className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" /><p className="text-muted-foreground text-sm">Nenhum serviço concluído neste período.</p></div>
                  )}
                  {filteredCompleted.map(b => (
                    <div key={b.id} className="p-4 bg-card/60 backdrop-blur-sm rounded-xl border border-primary/10 hover:border-primary/20 transition-all">
                      {editingId === b.id ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <input value={editService} onChange={e => setEditService(e.target.value)} placeholder="Serviço" className="bg-background/50 border border-primary/10 p-2.5 rounded-lg text-sm text-foreground outline-none focus:border-primary/40" />
                            <input value={editPrice} onChange={e => setEditPrice(e.target.value)} type="number" placeholder="Valor" className="bg-background/50 border border-primary/10 p-2.5 rounded-lg text-sm font-mono text-foreground outline-none focus:border-primary/40" />
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Nome" className="bg-background/50 border border-primary/10 p-2.5 rounded-lg text-sm text-foreground outline-none focus:border-primary/40" />
                            <input value={editDate} onChange={e => setEditDate(e.target.value)} placeholder="Data" className="bg-background/50 border border-primary/10 p-2.5 rounded-lg text-sm text-foreground outline-none focus:border-primary/40" />
                            <input value={editTime} onChange={e => setEditTime(e.target.value)} placeholder="Horário" className="bg-background/50 border border-primary/10 p-2.5 rounded-lg text-sm text-foreground outline-none focus:border-primary/40" />
                          </div>
                          <div className="flex gap-2">
                            <button onClick={saveEdit} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-bold hover:scale-105 active:scale-95 transition-all">Salvar</button>
                            <button onClick={() => setEditingId(null)} className="px-4 py-2 bg-secondary text-muted-foreground rounded-lg text-xs font-medium hover:text-foreground transition-colors">Cancelar</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="font-medium text-foreground">{b.name} — <span className="text-primary">{b.service}</span></p>
                            <p className="text-xs text-muted-foreground">{b.date} às {b.time}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-sm text-primary">R$ {b.price}</span>
                            <button onClick={() => startEdit(b)} className="text-muted-foreground hover:text-primary text-sm transition-colors p-1.5 rounded-lg hover:bg-primary/10"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => handleDeleteCompleted(b.id)} className="text-muted-foreground hover:text-destructive text-sm transition-colors p-1.5 rounded-lg hover:bg-destructive/10"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── ADD TAB ── */}
          {tab === 'add' && (
            <div className="max-w-lg mx-auto space-y-6">
              <div className="bg-card/60 backdrop-blur-sm rounded-2xl border border-primary/10 p-6 md:p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Plus className="w-5 h-5 text-primary" /></div>
                  <div>
                    <h3 className="font-bold text-foreground">{addMode === 'booking' ? 'Adicionar Agendamento' : 'Bloquear Agenda'}</h3>
                    <p className="text-xs text-muted-foreground">{addMode === 'booking' ? 'O serviço irá para a lista de agendamentos' : 'Defina horários em que a agenda estará fechada'}</p>
                  </div>
                </div>

                {/* Mode selector */}
                <div className="flex bg-background/80 p-1 rounded-xl border border-primary/5 mb-6">
                  <button type="button" onClick={() => setAddMode('booking')} className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${addMode === 'booking' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                    Adicionar Agendamento
                  </button>
                  <button type="button" onClick={() => setAddMode('block')} className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${addMode === 'block' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                    Bloquear Horário
                  </button>
                </div>

                {addMode === 'booking' ? (
                  <div className="space-y-5">
                    {/* Service quick select */}
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3 block">Serviço Rápido</label>
                      <div className="grid grid-cols-2 gap-2">
                        {SERVICES.map(s => (
                          <button
                            key={s.name}
                            type="button"
                            onClick={() => handleSelectService(s.name)}
                            className={`p-3 rounded-xl text-xs font-medium transition-all border text-left ${manualService === s.name ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-background/50 border-primary/5 text-muted-foreground hover:border-primary/20 hover:text-foreground'}`}
                          >
                            <span className="block">{s.name}</span>
                            <span className="font-mono text-[10px] opacity-70">R$ {s.price}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-2 block">Ou nome personalizado</label>
                      <input type="text" value={manualService} onChange={e => setManualService(e.target.value)} placeholder="Nome do serviço" className="w-full bg-background/50 border border-primary/10 focus:border-primary/40 p-3.5 rounded-xl outline-none transition-all text-foreground text-sm placeholder:text-muted-foreground/40" />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-2 block">Valor (R$)</label>
                        <input type="number" value={manualPrice} onChange={e => setManualPrice(e.target.value)} placeholder="0" className="w-full bg-background/50 border border-primary/10 focus:border-primary/40 p-3.5 rounded-xl outline-none transition-all text-foreground text-sm font-mono placeholder:text-muted-foreground/40" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-2 block">Horário</label>
                        <input type="time" value={manualTime} onChange={e => setManualTime(e.target.value)} className="w-full bg-background/50 border border-primary/10 focus:border-primary/40 p-3.5 rounded-xl outline-none transition-all text-foreground text-sm" style={{ colorScheme: 'dark' }} />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-2 block">Nome da cliente</label>
                      <input type="text" value={manualName} onChange={e => setManualName(e.target.value)} placeholder="Nome da cliente" className="w-full bg-background/50 border border-primary/10 focus:border-primary/40 p-3.5 rounded-xl outline-none transition-all text-foreground text-sm placeholder:text-muted-foreground/40" />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-2 block">WhatsApp da cliente</label>
                      <input type="tel" value={manualPhone} onChange={e => setManualPhone(formatPhone(e.target.value))} placeholder="(41) 99999-9999" maxLength={15} className="w-full bg-background/50 border border-primary/10 focus:border-primary/40 p-3.5 rounded-xl outline-none transition-all text-foreground text-sm placeholder:text-muted-foreground/40" />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-2 block">Data (DD/MM/AAAA)</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={manualDate}
                        onChange={e => setManualDate(maskDate(e.target.value))}
                        placeholder="07/08/2026"
                        maxLength={10}
                        className="w-full bg-background/50 border border-primary/10 focus:border-primary/40 p-3.5 rounded-xl outline-none transition-all text-foreground text-sm placeholder:text-muted-foreground/40"
                      />
                    </div>

                    {manualError && (
                      <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm font-medium">
                        ⚠️ {manualError}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleAddManualService}
                      disabled={isAddingManual}
                      className="w-full py-4 bg-primary text-primary-foreground font-bold rounded-xl transition-all hover:shadow-[0_0_25px_-5px_hsl(6_48%_68%/0.5)] hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {isAddingManual ? (
                        <><div className="w-4 h-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />Salvando...</>
                      ) : (
                        <><Plus className="w-5 h-5" /> Adicionar aos Agendamentos</>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-2 block">Data (DD/MM/AAAA)</label>
                      <input type="text" inputMode="numeric" value={blockDate} onChange={e => setBlockDate(maskDate(e.target.value))} placeholder="07/08/2026" maxLength={10} className="w-full bg-background/50 border border-primary/10 focus:border-primary/40 p-3.5 rounded-xl outline-none transition-all text-foreground text-sm placeholder:text-muted-foreground/40" />
                    </div>

                    <div className="flex items-center justify-between bg-background/50 border border-primary/10 p-4 rounded-xl">
                      <span className="text-sm text-foreground font-medium">Bloquear o dia inteiro</span>
                      <button type="button" onClick={() => setBlockAllDay(!blockAllDay)} className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors duration-300 ${blockAllDay ? 'bg-primary' : 'bg-zinc-700'}`}>
                        <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-300 ${blockAllDay ? 'translate-x-5' : 'translate-x-0'}`} />
                      </button>
                    </div>

                    {!blockAllDay && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-2 block">Horário de Início</label>
                          <input type="time" value={blockStart} onChange={e => setBlockStart(e.target.value)} className="w-full bg-background/50 border border-primary/10 focus:border-primary/40 p-3.5 rounded-xl outline-none transition-all text-foreground text-sm" style={{ colorScheme: 'dark' }} />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-2 block">Horário de Término</label>
                          <input type="time" value={blockEnd} onChange={e => setBlockEnd(e.target.value)} className="w-full bg-background/50 border border-primary/10 focus:border-primary/40 p-3.5 rounded-xl outline-none transition-all text-foreground text-sm" style={{ colorScheme: 'dark' }} />
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-2 block">Motivo (opcional)</label>
                      <input type="text" value={blockReason} onChange={e => setBlockReason(e.target.value)} placeholder="Folga, Almoço, Manutenção..." className="w-full bg-background/50 border border-primary/10 focus:border-primary/40 p-3.5 rounded-xl outline-none transition-all text-foreground text-sm placeholder:text-muted-foreground/40" />
                    </div>

                    <button type="button" onClick={handleSaveBlock} disabled={isAddingBlock} className="w-full py-4 bg-primary text-primary-foreground font-bold rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                      {isAddingBlock ? <><div className="w-4 h-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />Salvando...</> : 'Salvar Bloqueio'}
                    </button>
                  </div>
                )}
              </div>

              {/* Active blocks list */}
              {addMode === 'block' && blocks.length > 0 && (
                <div className="bg-card/60 backdrop-blur-sm rounded-2xl border border-primary/10 p-6 md:p-8">
                  <h4 className="font-bold text-sm text-foreground mb-4">Horários Bloqueados</h4>
                  <div className="space-y-3">
                    {blocks.map(b => (
                      <div key={b.id} className="flex items-center justify-between p-3.5 bg-background/50 border border-primary/5 rounded-xl text-sm">
                        <div className="space-y-1">
                          <p className="font-semibold text-foreground">{b.reason}</p>
                          <p className="text-xs text-muted-foreground">{b.date} • {b.allDay ? 'Dia Inteiro' : `${b.start} às ${b.end}`}</p>
                        </div>
                        <button onClick={() => handleDeleteBlock(b.id)} className="p-2 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-lg transition-colors" title="Remover">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── SETTINGS TAB ── */}
          {tab === 'settings' && (
            <div className="space-y-6 max-w-md mx-auto">
              <div className="bg-card/80 backdrop-blur-xl p-6 md:p-8 rounded-2xl border border-primary/10 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_20px_50px_-15px_rgba(0,0,0,0.5)] space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-foreground mb-1">Vincular Google Agenda</h3>
                  <p className="text-xs text-muted-foreground">Crie e configure uma agenda automática para o seu estúdio integrada com a sua conta Google pessoal.</p>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-2 block">Nome do Estúdio</label>
                    <input type="text" value={studioName} onChange={e => setStudioName(e.target.value)} placeholder="Ex: Studio Klarissa Guarezi" className="w-full bg-background/50 border border-primary/10 focus:border-primary/40 p-3.5 rounded-xl outline-none transition-all text-foreground text-sm placeholder:text-muted-foreground/40" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-2 block">E-mail Pessoal (Gmail)</label>
                    <input type="email" value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} placeholder="dona@gmail.com" className="w-full bg-background/50 border border-primary/10 focus:border-primary/40 p-3.5 rounded-xl outline-none transition-all text-foreground text-sm placeholder:text-muted-foreground/40" />
                  </div>
                  <button onClick={handleProvisionCalendar} disabled={!studioName || !ownerEmail || isProvisioning} className="w-full py-4 bg-primary text-primary-foreground font-bold rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    {isProvisioning ? 'Criando Agenda...' : 'Enviar Convite Oficial'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── EDIT BOOKING MODAL ── */}
          {editingBooking && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
              <div className="w-[95%] max-w-md mx-auto bg-zinc-950 rounded-2xl border border-primary/15 p-6 md:p-8 relative space-y-6">
                <button onClick={() => setEditingBooking(null)} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors p-1"><X className="w-5 h-5" /></button>
                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-foreground">Editar Agendamento</h3>
                  <p className="text-xs text-muted-foreground">Cliente: {editingBooking.name}</p>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs uppercase text-zinc-400 tracking-wider font-semibold mb-2">Serviço</label>
                    <select value={editBookingService} onChange={e => handleServiceChange(e.target.value)} className="w-full bg-zinc-800 border-none rounded-xl p-3.5 focus:ring-1 focus:ring-primary outline-none text-foreground text-sm" style={{ colorScheme: 'dark' }}>
                      {SERVICES.map(s => (<option key={s.name} value={s.name} className="bg-zinc-900 text-foreground">{s.name} (R$ {s.price},00)</option>))}
                    </select>
                  </div>
                  <div className="flex flex-row items-center gap-3 w-full">
                    <div className="w-1/2">
                      <label className="text-xs font-semibold text-gray-400 tracking-wider mb-2 block">NOVA DATA</label>
                      <input type="date" className="w-full bg-[#27272a] rounded-lg p-3 text-white border border-transparent outline-none focus:border-zinc-500" value={editBookingDate} onChange={e => setEditBookingDate(e.target.value)} style={{ colorScheme: 'dark' }} />
                    </div>
                    <div className="w-1/2">
                      <label className="text-xs font-semibold text-gray-400 tracking-wider mb-2 block">NOVO HORÁRIO</label>
                      <input type="time" className="w-full bg-[#27272a] rounded-lg p-3 text-white border border-transparent outline-none focus:border-zinc-500" value={editBookingTime} onChange={e => setEditBookingTime(e.target.value)} style={{ colorScheme: 'dark' }} />
                    </div>
                  </div>
                  <div className="flex justify-between items-center bg-zinc-800/40 p-4 rounded-xl border border-primary/5">
                    <span className="text-xs uppercase text-zinc-400 tracking-wider font-semibold">Valor do Serviço</span>
                    <span className="text-base font-mono font-bold text-primary">R$ {editBookingPrice},00</span>
                  </div>
                  <button onClick={handleSaveEditBooking} disabled={isSavingEdit || !editBookingDate || !editBookingTime || !editBookingService} className="w-full py-4 bg-primary text-primary-foreground font-bold rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    {isSavingEdit ? <><div className="w-4 h-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />Salvando...</> : 'Salvar Alterações'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── CONFIRM CANCEL MODAL ── */}
          {cancellingBooking && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
              <div className="bg-card w-full max-w-sm rounded-3xl border border-primary/15 p-6 md:p-8 relative space-y-6">
                <button onClick={() => setCancellingBooking(null)} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors p-1"><X className="w-5 h-5" /></button>
                <div className="space-y-2 text-center pt-2">
                  <h3 className="text-lg font-bold text-foreground">Confirmar Cancelamento</h3>
                  <p className="text-sm text-muted-foreground">Tem certeza que deseja cancelar o agendamento de <span className="font-semibold text-foreground">{cancellingBooking.name}</span>?</p>
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={() => setCancellingBooking(null)} className="flex-1 py-3 bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80 rounded-xl text-xs font-bold transition-all">Voltar</button>
                  <button onClick={handleConfirmCancel} className="flex-1 py-3 bg-destructive/15 text-destructive hover:bg-destructive hover:text-destructive-foreground border border-destructive/20 rounded-xl text-xs font-bold transition-all">Sim, Cancelar</button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default AdminPanel;

import { useState, useMemo, useEffect } from 'react';
import { SERVICES, isDayAllowed, getTimesForDate, WHATSAPP_NUMBER, generateWhatsAppUrl, formatPhone, getBookingDuration, ScheduleBlock, generateUUID } from '@/lib/types';
import { addBooking, getBookings, getBlocks } from '@/lib/bookingStore';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CheckCircle, X, Plus } from 'lucide-react';

const PIX_KEY = '00020126580014BR.GOV.BCB.PIX013607ce7f99-96bd-4bec-82bc-fecc91ad91525204000053039865802BR5925Klarissa Hemanuely Sabino6009SAO PAULO621405105q0TQIlKGk6304420A';
const SINAL_VALUE = 50;

type ServiceType = typeof SERVICES[0];

const BookingSection = () => {
  const [step, setStep] = useState(1);
  const [activeCategory, setActiveCategory] = useState('Unhas');
  const [selectedService, setSelectedService] = useState<ServiceType | null>(null);
  const [extras, setExtras] = useState<ServiceType[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedTime, setSelectedTime] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastWhatsAppUrl, setLastWhatsAppUrl] = useState('');

  // Estados do Modal Pix
  const [showPixModal, setShowPixModal] = useState(false);
  const [pixCopiado, setPixCopiado] = useState(false);
  
  // Estados de Upload do Comprovante
  const [comprovanteFile, setComprovanteFile] = useState<File | null>(null);
  const [comprovantePreview, setComprovantePreview] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const [comprovanteError, setComprovanteError] = useState('');

  const totalDuration = useMemo(() => {
    if (!selectedService) return 0;
    return selectedService.time + extras.reduce((sum, e) => sum + e.time, 0);
  }, [selectedService, extras]);

  const [availableTimes, setAvailableTimes] = useState<string[]>([]);
  const [googleBookings, setGoogleBookings] = useState<Booking[]>([]);
  const [googleBlocks, setGoogleBlocks] = useState<ScheduleBlock[]>([]);

  const refreshCalendarEvents = () => {
    fetch(`/api/calendar?realtime=true&t=${Date.now()}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.bookings)) {
          setGoogleBookings(data.bookings);
        }
        if (Array.isArray(data.blocks)) {
          setGoogleBlocks(data.blocks);
        }
      })
      .catch((err) => {
        console.error("Error loading events from Google Calendar API:", err);
      });
  };

  // Load schedule events from Google Calendar API on mount to act as source of truth
  useEffect(() => {
    refreshCalendarEvents();
  }, []);

  useEffect(() => {
    if (selectedDate) {
      refreshCalendarEvents();
    }
  }, [selectedDate]);

  useEffect(() => {
    if (!selectedDate || !selectedService) {
      setAvailableTimes([]);
      return;
    }

    const dateStr = format(selectedDate, 'dd/MM/yyyy');
    const baseTimes = getTimesForDate(selectedDate);

    const calculateLocalSlots = () => {
      // Mescla reservas locais e do Google Calendar para evitar duplicados e manter consistência imediata
      const localBookings = getBookings().filter((b) => b.date === dateStr && b.status !== 'completed');
      const apiBookings = googleBookings.filter((b) => b.date === dateStr && b.status !== 'completed');
      const bookings = [...apiBookings];
      localBookings.forEach(lb => {
        const lbIdNormalized = lb.id.replace(/-/g, '').toLowerCase();
        if (!bookings.some(ab => ab.id === lb.id || ab.id.replace(/-/g, '').toLowerCase() === lbIdNormalized)) {
          bookings.push(lb);
        }
      });

      const localBlocks = getBlocks().filter((block) => block.date === dateStr);
      const apiBlocks = googleBlocks.filter((block) => block.date === dateStr);
      const blocks = [...apiBlocks];
      localBlocks.forEach(lb => {
        const lbIdNormalized = lb.id.replace(/-/g, '').toLowerCase();
        if (!blocks.some(ab => ab.id === lb.id || ab.id.replace(/-/g, '').toLowerCase() === lbIdNormalized)) {
          blocks.push(lb);
        }
      });

      const timeToMinutes = (t: string) => {
        if (!t || typeof t !== 'string') return 0;
        const parts = t.split(':');
        if (parts.length < 2) return 0;
        const [h, m] = parts.map(Number);
        return h * 60 + m;
      };

      const now = new Date();
      const isToday = selectedDate.toDateString() === now.toDateString();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      return baseTimes.filter((timeStr) => {
        const start = timeToMinutes(timeStr);
        const end = start + totalDuration;

        // Filter out past times for today
        if (isToday && start < currentMinutes) {
          return false;
        }

        // Intervalo de almoço fixo das 12:00 às 13:00 (720 a 780 minutos)
        const lunchStart = 720;
        const lunchEnd = 780;
        const overlapsLunch = Math.max(start, lunchStart) < Math.min(end, lunchEnd);
        if (overlapsLunch) {
          return false;
        }

        // Limite de segurança do dia (expediente finaliza às 18:00 em dias de semana, 17:00 aos Sábados)
        const isSaturday = selectedDate.getDay() === 6;
        const limitOfDay = isSaturday ? 1020 : 1080;
        if (end > limitOfDay) {
          return false;
        }

        // Check overlap with schedule blocks of the day
        const hasBlockOverlap = blocks.some((block) => {
          if (block.allDay) return true;
          if (!block.start || !block.end) return false;
          
          const blockStart = timeToMinutes(block.start);
          const blockEnd = timeToMinutes(block.end);
          
          return Math.max(start, blockStart) < Math.min(end, blockEnd);
        });

        if (hasBlockOverlap) {
          return false;
        }

        // Check overlap with any booking of the day
        const hasOverlap = bookings.some((b) => {
          if (!b || !b.time) return false;
          const bStart = timeToMinutes(b.time);
          const bDuration = getBookingDuration(b.service || '');
          const bEnd = bStart + bDuration;

          return Math.max(start, bStart) < Math.min(end, bEnd);
        });

        return !hasOverlap;
      });
    };

    const localSlots = calculateLocalSlots();
    setAvailableTimes(localSlots);
  }, [selectedDate, selectedService, extras, totalDuration, googleBookings, googleBlocks]);

  // Combined service name and price
  const combinedServiceName = useMemo(() => {
    if (!selectedService) return '';
    const names = [selectedService.name, ...extras.map(e => e.name)];
    return names.join(' + ');
  }, [selectedService, extras]);

  const totalPrice = useMemo(() => {
    if (!selectedService) return 0;
    return selectedService.price + extras.reduce((sum, e) => sum + e.price, 0);
  }, [selectedService, extras]);

  // Order bump: only suggest small add-on nail services
  const availableExtras = useMemo(() => {
    if (!selectedService) return [];
    return SERVICES.filter(s => 
      s.name !== selectedService.name && 
      (s.name === 'Remoção' || s.name === 'Esmaltação em Gel' || s.name === 'Banho de Gel')
    );
  }, [selectedService]);

  const handleSelectService = (s: ServiceType) => {
    setSelectedService(s);
    setExtras([]);
    setStep(2);
  };

  const handleToggleExtra = (s: ServiceType) => {
    setExtras(prev => {
      const exists = prev.find(e => e.name === s.name);
      if (exists) return prev.filter(e => e.name !== s.name);
      return [...prev, s];
    });
  };

  const handleSkipExtras = () => {
    setStep(2);
  };

  const handleConfirmExtras = () => {
    setStep(2);
  };

  const handleSelectDate = (date: Date | undefined) => {
    if (date) {
      setSelectedDate(date);
      setSelectedTime('');
      setStep(3);
    }
  };

  const handleSelectTime = (time: string) => {
    setSelectedTime(time);
    setStep(4);
  };

  const compressAndGetBase64 = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1200;
          let width = img.width;
          let height = img.height;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(e.target?.result as string || '');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => resolve(e.target?.result as string || '');
        img.src = e.target?.result as string;
      };
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setComprovanteFile(file);
      setComprovanteError('');
      try {
        const base64 = await compressAndGetBase64(file);
        setComprovantePreview(base64);
      } catch (err) {
        console.warn('Preview error:', err);
      }
    }
  };

  const handleConfirm = () => {
    if (!name.trim() || !phone.trim() || !selectedService || !selectedDate || !selectedTime) return;
    setShowPixModal(true);
  };

  const handlePixSubmit = async () => {
    if (!comprovanteFile && !comprovantePreview) {
      setComprovanteError('O comprovante é obrigatório para confirmar o agendamento.');
      return;
    }

    setIsUploading(true);
    let comprovanteUrl = '';

    try {
      let base64 = comprovantePreview;
      if (!base64 && comprovanteFile) {
        base64 = await compressAndGetBase64(comprovanteFile);
      }

      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: base64,
          filename: comprovanteFile?.name || 'comprovante.jpg',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.url) {
          comprovanteUrl = data.url;
        }
      }
    } catch (err) {
      console.warn('Upload error, fallback gracefully:', err);
    } finally {
      setIsUploading(false);
    }

    finishBookingFlow(comprovanteUrl);
  };

  const finishBookingFlow = async (comprovanteUrl?: string) => {
    if (!selectedDate || !selectedTime || !name.trim()) return;
    const dateStr = format(selectedDate, 'dd/MM/yyyy');
    const booking = {
      id: generateUUID(),
      service: combinedServiceName,
      price: totalPrice,
      date: dateStr,
      time: selectedTime,
      name: name.trim(),
      phone: phone.trim(),
      status: 'accepted' as const,
    };

    setIsSubmitting(true);

    // 1. Salva imediatamente no banco local (garante que não se perde)
    addBooking(booking);

    // 2. Prepara mensagem para o WhatsApp com link oficial do comprovante
    let msg = `✨ *STUDIO KLARISSA GUAREZI* ✨\n\nOlá Klarissa! 🌸\nMeu nome é *${booking.name}*.\nAcabei de realizar meu agendamento pelo site:\n\n📋 *Serviço:* ${booking.service}\n💰 *Valor:* R$ ${booking.price},00\n📅 *Data:* ${booking.date}\n🕐 *Horário:* ${booking.time}\n📱 *Meu WhatsApp:* ${booking.phone}\n\n💵 *Sinal Pago:* R$ ${SINAL_VALUE},00`;

    if (comprovanteUrl) {
      msg += `\n\n🧾 *Comprovante do Sinal:*\n${comprovanteUrl}`;
    }

    msg += `\n\nObrigado! 💕`;

    const zapUrl = generateWhatsAppUrl(WHATSAPP_NUMBER, msg);
    setLastWhatsAppUrl(zapUrl);

    // 3. Sincroniza com o Google Calendar garantindo que seja registrado antes do redirecionamento
    try {
      const calendarPromise = fetch('/api/calendar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'booking',
          booking,
          duration: totalDuration,
        }),
        keepalive: true,
      });

      // Aguarda até 2.5s para a criação no Google Calendar
      const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 2500));
      await Promise.race([calendarPromise, timeoutPromise]);
    } catch (err) {
      console.warn("Background Google Calendar sync error:", err);
    }

    // 4. Conclui o fluxo e abre o WhatsApp
    setIsSubmitting(false);
    setShowPixModal(false);
    setShowSuccess(true);

    try {
      window.location.href = zapUrl;
    } catch (e) {
      console.warn("Auto-redirect to WhatsApp error:", e);
    }

    // 5. Limpa os campos do formulário
    setStep(1);
    setSelectedService(null);
    setExtras([]);
    setSelectedDate(undefined);
    setSelectedTime('');
    setName('');
    setPhone('');
    setComprovanteFile(null);
    setComprovantePreview('');
    setComprovanteError('');
  };

  const goBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  return (
    <>
      <section id="agendar" className="pt-24 pb-12 px-4 md:px-6 max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold">Agende seu horário</h2>
          <p className="text-muted-foreground mt-2">Escolha o serviço e o melhor momento para você.</p>
        </div>

        <div className="glass rounded-3xl p-4 md:p-8 card-shadow min-h-[400px]">
          {/* Steps */}
          <div className="flex justify-between mb-10 px-2 md:px-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex flex-col items-center gap-2">
                <div
                  className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center font-bold transition-colors text-sm',
                    step >= i ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                  )}
                >
                  {i}
                </div>
                <span className="text-xs text-muted-foreground hidden md:block">
                  {['Serviço', 'Data', 'Horário', 'Dados'][i - 1]}
                </span>
              </div>
            ))}
          </div>

          {step > 1 && (
            <button onClick={goBack} className="mb-4 text-sm text-muted-foreground hover:text-foreground transition-colors">
              ← Voltar
            </button>
          )}

          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
                {/* Category Tabs */}
                <div className="flex justify-center gap-2 mb-8 flex-wrap">
                  {Array.from(new Set(SERVICES.map(s => s.category))).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setActiveCategory(cat)}
                      className={cn(
                        "px-5 py-2 rounded-full text-sm font-semibold transition-all duration-300",
                        activeCategory === cat
                          ? "bg-primary text-primary-foreground shadow-md"
                          : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                      )}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide -mx-2 px-2">
                  {SERVICES.filter(s => s.category === activeCategory).map((s) => (
                    <button
                      key={s.name}
                      onClick={() => handleSelectService(s)}
                      className="flex-shrink-0 w-[200px] md:w-[220px] h-[240px] md:h-[270px] rounded-2xl border border-border hover:border-primary/50 transition-all text-center group overflow-hidden snap-center relative"
                    >
                      <img
                        src={s.image}
                        alt={s.name}
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                        width={220}
                        height={270}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
                      <div className="absolute bottom-0 left-0 right-0 p-4 text-left">
                        <h3 className="font-bold text-sm md:text-base text-white group-hover:text-primary transition-colors">{s.name}</h3>
                        <p className="text-xs text-white/70 mt-1">{s.time} min</p>
                        <span className="text-lg font-mono font-bold mt-1 text-primary block">R$ {s.price}</span>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3 mt-3 px-4">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground flex items-center gap-2">
                    ← Arraste para o lado →
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }} className="flex justify-center">
                <div className="bg-secondary rounded-2xl p-4 border border-border">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={handleSelectDate}
                    locale={ptBR}
                    disabled={(date) => {
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      return date < today || !isDayAllowed(date);
                    }}
                    className="pointer-events-auto"
                  />
                  <p className="text-xs text-muted-foreground mt-3 px-2 uppercase tracking-widest text-center">
                    Segunda a Sábado • Domingo Fechado
                  </p>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
                <p className="text-sm text-muted-foreground mb-4 text-center">
                  {selectedDate && format(selectedDate, "EEEE, dd 'de' MMMM", { locale: ptBR })}
                </p>
                <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                  {availableTimes.map((time) => (
                    <button
                      key={time}
                      onClick={() => handleSelectTime(time)}
                      className={cn(
                        'py-3 rounded-xl font-mono font-medium border transition-all text-sm md:text-base',
                        selectedTime === time
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-secondary border-border hover:border-primary/50'
                      )}
                    >
                      {time}
                    </button>
                  ))}
                  {availableTimes.length === 0 && (
                    <p className="col-span-full text-center text-sm text-muted-foreground py-8">
                      Nenhum horário disponível para este serviço nesta data.
                    </p>
                  )}
                </div>
              </motion.div>
            )}

            {step === 4 && (
              <motion.div key="step4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }} className="max-w-md mx-auto">
                <div className="bg-secondary/50 rounded-2xl p-4 mb-6 border border-border text-sm space-y-1">
                  <p><span className="text-muted-foreground">Serviço:</span> <span className="font-semibold">{combinedServiceName}</span></p>
                  <p><span className="text-muted-foreground">Data:</span> <span className="font-semibold">{selectedDate && format(selectedDate, 'dd/MM/yyyy')}</span></p>
                  <p><span className="text-muted-foreground">Horário:</span> <span className="font-semibold">{selectedTime}</span></p>
                  <p><span className="text-muted-foreground">Valor:</span> <span className="font-semibold font-mono">R$ {totalPrice},00</span></p>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs uppercase tracking-widest text-muted-foreground mb-2">Nome Completo</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ex: Maria Silva"
                      className="w-full bg-secondary border border-border rounded-xl p-4 focus:border-primary outline-none transition-colors text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-widest text-muted-foreground mb-2">WhatsApp</label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(formatPhone(e.target.value))}
                      placeholder="(41) 99999-9999"
                      maxLength={15}
                      className="w-full bg-secondary border border-border rounded-xl p-4 focus:border-primary outline-none transition-colors text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                  <button
                    onClick={handleConfirm}
                    disabled={!name.trim() || !phone.trim()}
                    className="w-full py-4 bg-primary text-primary-foreground font-bold rounded-xl glow-shadow disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
                  >
                    Finalizar Agendamento
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* Loading Overlay */}
      <AnimatePresence>
        {isSubmitting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
          >
            <div className="bg-card p-8 rounded-3xl card-shadow w-full max-w-sm border border-border text-center flex flex-col items-center gap-4">
              <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
              <h3 className="text-lg font-bold">Salvando seu Horário...</h3>
              <p className="text-muted-foreground text-sm">
                Estamos registrando seu agendamento na nossa agenda e preparando sua mensagem do WhatsApp.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Success Popup */}
      <AnimatePresence>
        {showSuccess && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-card p-8 rounded-3xl card-shadow w-full max-w-sm border border-border text-center relative space-y-4"
            >
              <button
                onClick={() => setShowSuccess(false)}
                className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
              <CheckCircle className="w-16 h-16 text-emerald-400 mx-auto" />
              <div>
                <h3 className="text-xl font-bold mb-1">Agendamento Pré-Reservado!</h3>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Seu horário já foi reservado no sistema! Para confirmação definitiva, envie o comprovante do sinal de <strong>R$ {SINAL_VALUE},00</strong> no WhatsApp da Klarissa.
                </p>
              </div>

              <a
                href={lastWhatsAppUrl || generateWhatsAppUrl(WHATSAPP_NUMBER, 'Olá Studio Klarissa Guarezi! Gostaria de confirmar meu agendamento.')}
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-2xl transition-all flex items-center justify-center gap-2 text-sm shadow-[0_0_20px_rgba(16,185,129,0.3)] active:scale-95"
              >
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                  <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/>
                </svg>
                Abrir WhatsApp da Klarissa
              </a>

              <button
                type="button"
                onClick={() => setShowSuccess(false)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors underline pt-1 block mx-auto"
              >
                Fechar
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pix Modal */}
      <AnimatePresence>
        {showPixModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/90 backdrop-blur-sm overflow-y-auto"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-card p-6 md:p-8 rounded-3xl card-shadow w-full max-w-md border border-border relative my-auto"
            >
              <button
                onClick={() => {
                  setShowPixModal(false);
                  setComprovanteFile(null);
                  setComprovanteError('');
                }}
                className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors p-1"
              >
                <X className="w-5 h-5" />
              </button>
              
              <div className="text-center space-y-4">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full text-xs font-semibold">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Sinal Obrigatório de Reserva
                </div>

                <h3 className="text-xl font-bold">Pague o Sinal via Pix</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Para garantir a reserva do seu horário exclusivo, realize o pagamento do sinal de <strong className="text-foreground">R$ {SINAL_VALUE},00</strong>. Esse valor será abatido no total do seu atendimento.
                </p>

                {/* QR Code */}
                <div className="bg-white p-3 rounded-2xl mx-auto inline-block card-shadow border border-border">
                  <img 
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(PIX_KEY)}`} 
                    alt="QR Code Pix"
                    className="w-36 h-36 mx-auto"
                  />
                </div>

                {/* Chave Pix e Dados */}
                <div className="bg-secondary/60 p-3.5 rounded-xl border border-border text-left space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">Favorecida:</span>
                    <span className="font-semibold text-foreground">Klarissa Hemanuely Sabino</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">Valor do Sinal:</span>
                    <span className="font-mono font-bold text-emerald-400">R$ {SINAL_VALUE},00</span>
                  </div>
                  <div className="pt-2 border-t border-border/50">
                    <p className="text-[10px] font-mono text-muted-foreground break-all mb-2 select-all bg-background/50 p-2 rounded line-clamp-2">
                      {PIX_KEY}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(PIX_KEY);
                        setPixCopiado(true);
                        setTimeout(() => setPixCopiado(false), 2500);
                      }}
                      className="px-4 py-2.5 bg-primary text-primary-foreground font-bold rounded-lg hover:bg-primary/90 transition-all text-xs w-full flex items-center justify-center gap-2 active:scale-95"
                    >
                      {pixCopiado ? '✓ Código Pix Copiado com Sucesso!' : '📋 Copiar Código Pix Copia e Cola'}
                    </button>
                  </div>
                </div>

                {/* Área de Anexo do Comprovante */}
                <div className="text-left space-y-2 mt-4 pt-3 border-t border-border/50">
                  <label className="block text-xs uppercase tracking-widest text-muted-foreground font-semibold">
                    Envie o Comprovante
                  </label>
                  
                  <div className="flex items-center gap-3">
                    <label className="px-4 py-2.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-xl text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-2 flex-shrink-0">
                      <span>Escolher Arquivo</span>
                      <input 
                        type="file" 
                        accept="image/*"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                    </label>
                    
                    {comprovanteFile ? (
                      <div className="flex items-center gap-2 text-xs text-emerald-400 font-medium truncate flex-1 bg-secondary/40 p-1.5 rounded-lg border border-emerald-500/20">
                        {comprovantePreview && (
                          <img src={comprovantePreview} alt="Preview" className="w-7 h-7 rounded object-cover border border-emerald-500/40" />
                        )}
                        <span className="truncate">{comprovanteFile.name}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground/60 italic truncate">Nenhum arquivo selecionado</span>
                    )}
                  </div>

                  {comprovanteError && <p className="text-destructive text-xs font-medium">⚠️ {comprovanteError}</p>}
                </div>

                <button
                  type="button"
                  onClick={handlePixSubmit}
                  disabled={isSubmitting || isUploading}
                  className="w-full mt-3 py-4 bg-primary text-primary-foreground font-bold rounded-xl glow-shadow transition-all active:scale-[0.98] flex items-center justify-center gap-2 text-sm shadow-[0_0_20px_rgba(255,255,255,0.1)] disabled:opacity-50"
                >
                  {isUploading || isSubmitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />
                      Enviando comprovante...
                    </span>
                  ) : (
                    'Confirmar Agendamento'
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default BookingSection;

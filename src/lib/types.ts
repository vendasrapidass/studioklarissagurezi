export interface Service {
  name: string;
  time: number;
  price: number;
  image: string;
  category: string;
}

export interface ScheduleBlock {
  id: string;
  date: string;
  allDay: boolean;
  start?: string;
  end?: string;
  reason: string;
}

export interface Booking {
  id: string;
  service: string;
  price: number;
  date: string;
  time: string;
  name: string;
  phone: string;
  status: 'pending' | 'accepted' | 'completed';
}

export const SERVICES: Service[] = [
  { name: 'Alongamento Molde F1', time: 180, price: 155, image: 'https://i.imgur.com/VQWp5Bu.jpeg', category: 'Unhas' },
  { name: 'Manutenção Alongamento', time: 150, price: 115, image: 'https://i.imgur.com/O2bwT3H.jpeg', category: 'Unhas' },
  { name: 'Banho de Gel', time: 120, price: 90, image: 'https://i.imgur.com/lA6WWaC.jpeg', category: 'Unhas' },
  { name: 'Esmaltação em Gel', time: 120, price: 70, image: 'https://i.imgur.com/0C4YNsq.jpeg', category: 'Unhas' },
];

export const GALLERY_IMAGES = [
  'https://i.imgur.com/qPlp82K.jpeg',
  'https://i.imgur.com/ZnqvpSs.jpeg',
  'https://i.imgur.com/6TxVITZ.jpeg',
  'https://i.imgur.com/VfrvuDC.jpeg',
  'https://i.imgur.com/IbTCZe2.jpeg'
];

export const WHATSAPP_NUMBER = '5541997114154';

export function isOpenNow(): boolean {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const timeValue = hour * 60 + minute;

  if (day === 0) return false;
  return timeValue >= 540 && timeValue < 1200; // 09:00 to 20:00
}

export function isDayAllowed(date: Date): boolean {
  return date.getDay() !== 0; // Fechado aos Domingos
}

export function getTimesForDate(date: Date): string[] {
  const day = date.getDay();
  if (day === 0) return []; // Domingos
  if (day === 6) {
    // Sábados: 10:00, 12:30 e 14:00
    return ['10:00', '12:30', '14:00'];
  }
  // Segunda a Sexta: 09:00, 10:00, 14:00, 17:00, 17:30, 18:00 e 18:30
  return ['09:00', '10:00', '14:00', '17:00', '17:30', '18:00', '18:30'];
}

export function getBookingDuration(serviceName: string): number {
  const names = serviceName.split(' + ');
  let total = 0;
  names.forEach(name => {
    const svc = SERVICES.find(s => s.name === name);
    if (svc) {
      total += svc.time;
    }
  });
  return total || 180; // default to 180min if unknown (lash designer standard)
}

export function generateWhatsAppUrl(phone: string, message: string): string {
  return `https://api.whatsapp.com/send?phone=${phone.replace(/\D/g, '')}&text=${encodeURIComponent(message)}`;
}

export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits.length ? `(${digits}` : '';
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}


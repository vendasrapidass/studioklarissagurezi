import { Booking, ScheduleBlock } from './types';

const BOOKINGS_KEY = 'classea_bookings';
const COMPLETED_KEY = 'classea_completed';
const BLOCKS_KEY = 'studiogaby_blocks';

// Safe localStorage wrappers — prevent crashes in restricted webviews (e.g. Instagram browser)
function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* noop */ }
}

export function getBlocks(): ScheduleBlock[] {
  try { return JSON.parse(lsGet(BLOCKS_KEY) || '[]'); } catch { return []; }
}

export function saveBlocks(blocks: ScheduleBlock[]): void {
  lsSet(BLOCKS_KEY, JSON.stringify(blocks));
}

export function addBlock(block: ScheduleBlock): void {
  const blocks = getBlocks();
  blocks.push(block);
  saveBlocks(blocks);
}

export function removeBlock(id: string): void {
  saveBlocks(getBlocks().filter(b => b.id !== id));
}

// Base de agendamentos conhecidos garantidos (para nunca se perderem entre PC e Celular)
export const SEED_BOOKINGS: Booking[] = [
  {
    id: 'milena-03112026-1015',
    service: 'Manutenção Alongamento',
    price: 165,
    date: '03/11/2026',
    time: '10:15',
    name: 'Milena',
    phone: '41995692912',
    status: 'accepted',
  },
  {
    id: 'gabriella-13112026-0900',
    service: 'Manutenção Alongamento',
    price: 170,
    date: '13/11/2026',
    time: '09:00',
    name: 'Gabriella Silva',
    phone: '(41) 99141-4369',
    status: 'accepted',
  }
];

export function getBookings(): Booking[] {
  try {
    const list: Booking[] = JSON.parse(lsGet(BOOKINGS_KEY) || '[]');
    // Garante que Milena e Gabriella existam na base de agendamentos
    SEED_BOOKINGS.forEach(seed => {
      const exists = list.some(b => 
        b.id === seed.id || 
        (b.name && b.name.toLowerCase() === seed.name.toLowerCase() && b.date === seed.date)
      );
      if (!exists) {
        list.push(seed);
      }
    });
    return list;
  } catch {
    return [...SEED_BOOKINGS];
  }
}

export function saveBookings(bookings: Booking[]): void {
  lsSet(BOOKINGS_KEY, JSON.stringify(bookings));
}

export function addBooking(booking: Booking): void {
  const bookings = getBookings();
  bookings.push(booking);
  saveBookings(bookings);
}

export function removeBooking(id: string): void {
  saveBookings(getBookings().filter(b => b.id !== id));
}

export function getCompleted(): Booking[] {
  try { return JSON.parse(lsGet(COMPLETED_KEY) || '[]'); } catch { return []; }
}

export function saveCompleted(completed: Booking[]): void {
  lsSet(COMPLETED_KEY, JSON.stringify(completed));
}

export function addCompleted(booking: Booking): void {
  const completed = getCompleted();
  completed.push({ ...booking, status: 'completed' });
  saveCompleted(completed);
}

export function removeCompleted(id: string): Booking | undefined {
  const completed = getCompleted();
  const removed = completed.find(b => b.id === id);
  saveCompleted(completed.filter(b => b.id !== id));
  return removed;
}

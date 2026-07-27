import {
  checkpointStatus,
  summarizeCheckpoints,
  overdueCheckpoints,
  DEFAULT_DUE_SOON_WINDOW_MS,
  type GovernanceForecastCheckpoint,
} from '../services/governanceForecastCheckpoints';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('checkpointStatus', () => {
  it('returns "completed" whenever completedAt is set, regardless of the window', () => {
    const checkpoint: GovernanceForecastCheckpoint = {
      id: 'c1',
      label: 'Signer prep',
      changeWindowStart: new Date(NOW.getTime() - DAY_MS), // already passed
      completedAt: new Date(NOW.getTime() - 2 * DAY_MS),
    };
    expect(checkpointStatus(checkpoint, NOW)).toBe('completed');
  });

  it('returns "overdue" once the change window has passed and nothing is completed', () => {
    const checkpoint: GovernanceForecastCheckpoint = {
      id: 'c2',
      label: 'Draft notes',
      changeWindowStart: new Date(NOW.getTime() - 1000),
    };
    expect(checkpointStatus(checkpoint, NOW)).toBe('overdue');
  });

  it('returns "due_soon" within the due-soon window', () => {
    const checkpoint: GovernanceForecastCheckpoint = {
      id: 'c3',
      label: 'Line up signers',
      changeWindowStart: new Date(NOW.getTime() + DAY_MS),
    };
    expect(checkpointStatus(checkpoint, NOW)).toBe('due_soon');
  });

  it('returns "upcoming" outside the due-soon window', () => {
    const checkpoint: GovernanceForecastCheckpoint = {
      id: 'c4',
      label: 'Long-range prep',
      changeWindowStart: new Date(NOW.getTime() + 30 * DAY_MS),
    };
    expect(checkpointStatus(checkpoint, NOW)).toBe('upcoming');
  });

  it('honors a custom due-soon window', () => {
    const checkpoint: GovernanceForecastCheckpoint = {
      id: 'c5',
      label: 'Custom window',
      changeWindowStart: new Date(NOW.getTime() + 10 * DAY_MS),
    };
    expect(checkpointStatus(checkpoint, NOW, 1 * DAY_MS)).toBe('upcoming');
    expect(checkpointStatus(checkpoint, NOW, 14 * DAY_MS)).toBe('due_soon');
  });

  it('treats the exact boundary of the due-soon window as due_soon', () => {
    const checkpoint: GovernanceForecastCheckpoint = {
      id: 'c6',
      label: 'Boundary',
      changeWindowStart: new Date(NOW.getTime() + DEFAULT_DUE_SOON_WINDOW_MS),
    };
    expect(checkpointStatus(checkpoint, NOW)).toBe('due_soon');
  });
});

describe('summarizeCheckpoints', () => {
  const checkpoints: GovernanceForecastCheckpoint[] = [
    { id: 'upcoming', label: 'Upcoming', changeWindowStart: new Date(NOW.getTime() + 30 * DAY_MS) },
    { id: 'overdue', label: 'Overdue', changeWindowStart: new Date(NOW.getTime() - DAY_MS) },
    {
      id: 'completed',
      label: 'Completed',
      changeWindowStart: new Date(NOW.getTime() - 5 * DAY_MS),
      completedAt: new Date(NOW.getTime() - 6 * DAY_MS),
    },
    { id: 'due-soon', label: 'Due soon', changeWindowStart: new Date(NOW.getTime() + DAY_MS) },
  ];

  it('attaches a status and msUntilChangeWindow to every checkpoint', () => {
    const reminders = summarizeCheckpoints(checkpoints, NOW);
    expect(reminders).toHaveLength(4);
    reminders.forEach((r) => expect(typeof r.msUntilChangeWindow).toBe('number'));
  });

  it('sorts overdue first, then due_soon, then upcoming, then completed', () => {
    const reminders = summarizeCheckpoints(checkpoints, NOW);
    expect(reminders.map((r) => r.id)).toEqual(['overdue', 'due-soon', 'upcoming', 'completed']);
  });

  it('overdueCheckpoints filters to only the overdue reminders', () => {
    const reminders = summarizeCheckpoints(checkpoints, NOW);
    expect(overdueCheckpoints(reminders).map((r) => r.id)).toEqual(['overdue']);
  });
});

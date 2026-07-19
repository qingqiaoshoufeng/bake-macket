let sessionEpoch = 0;

export type SessionSnapshot = number;

export function captureSession(): SessionSnapshot {
  return sessionEpoch;
}

export function isCurrentSession(snapshot: SessionSnapshot): boolean {
  return snapshot === sessionEpoch;
}

export function advanceSession(): void {
  sessionEpoch += 1;
}

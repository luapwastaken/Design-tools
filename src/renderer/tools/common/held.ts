import { useEffect, useState } from 'react';

/** how long work runs before it says so: a drag's renders come and go faster, and must not blink a busy mark */
const SHOW_AFTER = 300;

/** true once `on` has stayed true for a moment, so a busy mark only shows for work you'd wait on */
export function useHeld(on: boolean, ms = SHOW_AFTER): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!on) return setHeld(false);
    const t = setTimeout(() => setHeld(true), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return on && held;
}

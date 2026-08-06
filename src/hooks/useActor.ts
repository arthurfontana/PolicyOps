import { useUiStore } from '@/store/ui-store';

/** Nome de identificação do usuário para o histórico — não é login. */
export function useActor() {
  const actor = useUiStore((s) => s.actor);
  const setActor = useUiStore((s) => s.setActor);
  return { actor, setActor };
}

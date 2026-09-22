import type { Capability, Me } from '@crowd/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { api } from './api';
import { qk, useAuthState } from './queries';

export function useSession() {
  const state = useAuthState();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const me: Me | null = state.data?.user ?? null;

  const can = useCallback((cap: Capability) => !!me?.capabilities.includes(cap), [me]);

  const signedIn = useCallback(
    (user: Me) => {
      qc.setQueryData(qk.auth, (prev: typeof state.data) => ({
        ...(prev ?? { needsSetup: false, registrationOpen: false }),
        needsSetup: false,
        user,
      }));
    },
    [qc],
  );

  const signOut = useCallback(async () => {
    await api.auth.logout().catch(() => undefined);
    qc.clear();
    navigate('/login', { replace: true });
  }, [qc, navigate]);

  return { state, me, can, signedIn, signOut };
}

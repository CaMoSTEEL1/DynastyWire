"use client";

// React binding for the Saga (see lib/dynasty/saga.ts). Loads/seeds the per-dynasty record,
// exposes the live meters, and gives the Situation Room its mutators — resolve a decision,
// answer the media, and text a player. Every mutator applies pure meter math from saga.ts,
// persists through saga-store.ts, and re-renders. Meters seed once from the save's coach
// job security so an established hot seat carries in.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyDeltas,
  seedMetersFromCoach,
  type CoachBackstory,
  type Fallout,
  type LedgerEntry,
  type MediaAnswer,
  type RecruitThreadMessage,
  type Resolution,
  type SagaMeters,
  type SagaState,
  type StoryOption,
  type ThreadMessage,
} from "@/lib/dynasty/saga";
import { loadOrSeedSaga, saveSaga } from "@/lib/dynasty/saga-store";
import { useDynasty } from "./dynasty-context";

export interface UseSaga {
  ready: boolean;
  state: SagaState | null;
  /** Record a decision: apply base meter deltas, store the resolution, log the ledger. */
  resolve: (
    storylineId: string,
    meta: { week: number; year: number; category: Resolution["category"]; headline: string; playerName: string | null },
    option: StoryOption,
    fallout: Fallout
  ) => Promise<void>;
  /** Answer one media question — apply that answer's deltas once. */
  answerMedia: (storylineId: string, qIndex: number, answer: MediaAnswer) => Promise<void>;
  /** Append messages to a resolved situation's live player thread. */
  appendThread: (storylineId: string, messages: ThreadMessage[]) => Promise<void>;
  /** Append messages to a coach↔recruit thread (persisted across sessions). */
  appendRecruitThread: (recruitKey: string, messages: RecruitThreadMessage[]) => Promise<void>;
  /** Append to a coach↔figure (ad/booster/reporter) thread. */
  appendFigureThread: (figure: string, messages: RecruitThreadMessage[]) => Promise<void>;
  /** Apply raw meter deltas (e.g. a podium answer) — clamped and persisted. */
  adjustMeters: (deltas: Partial<SagaMeters>) => Promise<void>;
  /** Persist a recruit's generated dossier so it survives weeks and restarts. */
  saveRecruitDossier: (recruitKey: string, dossier: unknown) => Promise<void>;
  /** Save the coach's generated backstory and staff (null resets it). */
  saveBackstory: (backstory: CoachBackstory | null) => Promise<void>;
}

export function useSaga(): UseSaga {
  const { dynastyId, snapshot } = useDynasty();
  const [state, setState] = useState<SagaState | null>(null);
  const [ready, setReady] = useState(false);
  // Guard the seed against snapshot churn — only the FIRST load seeds from coach data.
  const loadedFor = useRef<string | null>(null);
  // The authoritative current state for mutations. NEVER compute the next state inside a
  // React setState updater and persist it after — React 18 may defer the updater past the
  // persist callback, silently dropping the write (this is exactly how backstories and
  // meter changes were getting lost).
  const stateRef = useRef<SagaState | null>(null);

  const job = snapshot?.coach?.jobSecurity ?? null;

  useEffect(() => {
    if (!dynastyId || dynastyId === "current") {
      // No real team resolved yet — don't seed a throwaway record.
      setReady(false);
      setState(null);
      stateRef.current = null;
      return;
    }
    if (loadedFor.current === dynastyId) return;
    loadedFor.current = dynastyId;
    let cancelled = false;
    (async () => {
      const s = await loadOrSeedSaga(dynastyId, seedMetersFromCoach(job));
      if (cancelled) return;
      stateRef.current = s;
      setState(s);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally keyed on dynastyId only; job is read at seed time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dynastyId]);

  // Serialize writes so rapid interactions (answer two media questions fast) don't race.
  // next is computed synchronously from stateRef (not inside the setState updater), so the
  // persisted object is always the one the user saw.
  const chain = useRef<Promise<void>>(Promise.resolve());
  const mutate = useCallback((fn: (prev: SagaState) => SagaState) => {
    const prev = stateRef.current;
    if (!prev) return Promise.resolve();
    const next = fn(prev);
    stateRef.current = next; // consecutive mutations compose on the freshest state
    setState(next);
    chain.current = chain.current.then(() => saveSaga(next)).catch(() => {});
    return chain.current;
  }, []);

  const resolve = useCallback<UseSaga["resolve"]>(
    async (id, meta, option, fallout) => {
      await mutate((prev) => {
        const meters = applyDeltas(prev.meters, fallout.meterDeltas);
        const resolution: Resolution = {
          storylineId: id,
          week: meta.week,
          year: meta.year,
          category: meta.category,
          headline: meta.headline,
          playerName: meta.playerName,
          option,
          fallout,
          thread: Array.isArray(fallout.playerThread) ? [...fallout.playerThread] : [],
          answered: {},
          resolvedAt: Date.now(),
        };
        const entry: LedgerEntry = {
          storylineId: id,
          week: meta.week,
          year: meta.year,
          headline: meta.headline,
          decision: option.label,
          outcome: fallout.outcome,
          at: Date.now(),
        };
        return {
          ...prev,
          meters,
          resolved: { ...prev.resolved, [id]: resolution },
          ledger: [entry, ...prev.ledger].slice(0, 100),
        };
      });
    },
    [mutate]
  );

  const answerMedia = useCallback<UseSaga["answerMedia"]>(
    async (id, qIndex, answer) => {
      await mutate((prev) => {
        const res = prev.resolved[id];
        if (!res || res.answered[qIndex]) return prev; // answer each question once
        const meters = applyDeltas(prev.meters, {
          mediaHeat: answer.mediaDelta,
          fanTrust: answer.fanDelta,
          lockerRoom: answer.lockerDelta,
        });
        return {
          ...prev,
          meters,
          resolved: {
            ...prev.resolved,
            [id]: { ...res, answered: { ...res.answered, [qIndex]: answer } },
          },
        };
      });
    },
    [mutate]
  );

  const appendThread = useCallback<UseSaga["appendThread"]>(
    async (id, messages) => {
      await mutate((prev) => {
        const res = prev.resolved[id];
        if (!res) return prev;
        return {
          ...prev,
          resolved: {
            ...prev.resolved,
            [id]: { ...res, thread: [...res.thread, ...messages] },
          },
        };
      });
    },
    [mutate]
  );

  const appendRecruitThread = useCallback<UseSaga["appendRecruitThread"]>(
    async (recruitKey, messages) => {
      await mutate((prev) => {
        const threads = prev.recruitThreads ?? {};
        const existing = threads[recruitKey] ?? [];
        return {
          ...prev,
          recruitThreads: { ...threads, [recruitKey]: [...existing, ...messages] },
        };
      });
    },
    [mutate]
  );

  const appendFigureThread = useCallback<UseSaga["appendFigureThread"]>(
    async (figure, messages) => {
      await mutate((prev) => {
        const threads = prev.figureThreads ?? {};
        const existing = threads[figure] ?? [];
        return { ...prev, figureThreads: { ...threads, [figure]: [...existing, ...messages] } };
      });
    },
    [mutate]
  );

  const adjustMeters = useCallback<UseSaga["adjustMeters"]>(
    async (deltas) => {
      await mutate((prev) => ({ ...prev, meters: applyDeltas(prev.meters, deltas) }));
    },
    [mutate]
  );

  const saveRecruitDossier = useCallback<UseSaga["saveRecruitDossier"]>(
    async (recruitKey, dossier) => {
      await mutate((prev) => ({
        ...prev,
        recruitDossiers: { ...(prev.recruitDossiers ?? {}), [recruitKey]: dossier },
      }));
    },
    [mutate]
  );

  const saveBackstory = useCallback<UseSaga["saveBackstory"]>(
    async (backstory) => {
      await mutate((prev) => {
        return {
          ...prev,
          backstory,
        };
      });
    },
    [mutate]
  );

  return { ready, state, resolve, answerMedia, appendThread, appendRecruitThread, appendFigureThread, adjustMeters, saveRecruitDossier, saveBackstory };
}

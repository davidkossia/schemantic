import { useCallback, useEffect, useReducer, useRef } from "react";
import type { Structure } from "../../src/core/schema";
import type { ImageInput } from "../../src/pipeline/model";
import { initialState, reduce, type UiState } from "./state";
import { localTransport } from "./localTransport";
import { wsTransport, type Transport } from "./transport";

export type StartInput = { file: File | null; sampleId: string | null; question: string };

export type Session = {
  state: UiState;
  start(input: StartInput): Promise<void>;
  approve(): void;
  edit(structure: Structure): void;
  reopen(): void;
  cancel(): void;
  dismissError(): void;
};

function socketUrl(): string {
  return `${window.location.origin.replace(/^http/, "ws")}/ws`;
}

function mediaTypeOf(file: File): ImageInput["mediaType"] | null {
  if (file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/webp") return file.type;
  return null;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function useSession(): Session {
  const [state, dispatch] = useReducer(reduce, initialState);
  const transport = useRef<Transport | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const t = import.meta.env.VITE_TRANSPORT === "local" ? localTransport() : wsTransport(socketUrl());
    transport.current = t;
    const unsubscribe = t.subscribe((message) => dispatch({ type: "server", message }));
    return () => {
      unsubscribe();
      t.close();
      transport.current = null;
    };
  }, []);

  const start = useCallback(async (input: StartInput): Promise<void> => {
    const t = transport.current;
    if (!t) return;
    if (input.file) {
      const mediaType = mediaTypeOf(input.file);
      if (!mediaType) {
        dispatch({
          type: "server",
          message: { type: "error", code: "unsupported_image", message: "Use a PNG, JPEG or WebP image." },
        });
        return;
      }
      const base64 = toBase64(await input.file.arrayBuffer());
      dispatch({ type: "started", question: input.question, imageUrl: URL.createObjectURL(input.file) });
      t.send({ type: "start", image: { mediaType, base64 }, sampleId: null, question: input.question });
      return;
    }
    const sample = stateRef.current.samples.find((s) => s.id === input.sampleId);
    if (!sample) return;
    dispatch({ type: "started", question: input.question, imageUrl: sample.imageUrl });
    t.send({ type: "start", image: null, sampleId: sample.id, question: input.question });
  }, []);

  const approve = useCallback((): void => {
    const structure = stateRef.current.structure;
    if (structure) transport.current?.send({ type: "approve", structure });
  }, []);
  const edit = useCallback((structure: Structure): void => dispatch({ type: "edited", structure }), []);
  const reopen = useCallback((): void => transport.current?.send({ type: "reopen" }), []);
  const cancel = useCallback((): void => transport.current?.send({ type: "cancel" }), []);
  const dismissError = useCallback((): void => dispatch({ type: "dismissed_error" }), []);

  return { state, start, approve, edit, reopen, cancel, dismissError };
}

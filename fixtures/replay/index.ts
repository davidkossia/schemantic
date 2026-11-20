import type { Query, Structure } from "../../src/core/schema";
import type { Sample } from "../../src/shared/protocol";
import { c01Fixture } from "./c01";
import { c09Fixture } from "./c09";

/** A recorded sample: what the reader returns, and the query the solver answers. */
export type ReplayFixture = { sample: Sample; reading: Structure; query: Query };

export const REPLAY_FIXTURES: ReplayFixture[] = [c01Fixture, c09Fixture];

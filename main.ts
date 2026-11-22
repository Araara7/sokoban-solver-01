// Sokoban solver: push-optimal A* per room, rooms solved one by one.
// A level is a hallway with independent rooms off it (3-4 boxes each); a box
// pushed out of a door is lost, so each room's optimum adds up to the level's.
// The search is over pushes only: a state is the boxes' squares plus the
// player's reachable region (named by its lowest square). It prunes the two
// deadlocks a box can never leave: a dead square (no pull, ignoring the other
// boxes, brings a box from it onto a goal) and a frozen 2x2 block of walls
// and boxes with a box off its goal. The estimate is the cheapest assignment
// of boxes to goals over walking distances, which never overestimates the
// pushes left, so the first solved state the search pops is push-optimal.
// Pure: budgets count states, never the clock; ties go by square order, so
// two runs answer alike byte for byte.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Deterministic budgets (states, never the clock): a room the generator
// keeps solves within 250_000 states, and A* explores a subset of that.
const MAX_STATES_PER_ROOM = 400_000;
const MAX_STATES_TOTAL = 4_000_000;

type Dir = [number, number, string, string];
const DIRS: Dir[] = [
  [0, -1, 'u', 'U'],
  [0, 1, 'd', 'D'],
  [-1, 0, 'l', 'L'],
  [1, 0, 'r', 'R'],
];

interface Level {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
}

/** A level in XSB text: its width and height, walls (short rows and squares outside padded as walls), goals, boxes and player. */
function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  return { w, h, wall, goals, boxes: boxes.sort((a, b) => a - b), player };
}

/** The squares from which a box alone can be pulled onto some goal (pulled back from the goals over open floor). */
function liveSquares(level: Level): Uint8Array {
  const { w, wall, goals } = level;
  const live = new Uint8Array(wall.length);
  const queue = [...goals];
  for (const g of goals) live[g] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi]!;
    for (const [dx, dy] of DIRS) {
      const d = dy * w + dx;
      const y = x - d;
      if (!wall[y] && !wall[y - d] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

/** Walking distances from one start over open floor (-1 where no walk reaches). */
function distances(wall: Uint8Array, w: number, from: number): Int32Array {
  const dist = new Int32Array(wall.length).fill(-1);
  const queue = [from];
  dist[from] = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi]!;
    for (const [dx, dy] of DIRS) {
      const q = p + dy * w + dx;
      if (!wall[q] && dist[q] < 0) {
        dist[q] = dist[p]! + 1;
        queue.push(q);
      }
    }
  }
  return dist;
}

/** The level's rooms: cut the dead squares of the player's row (the hallway: a box there reaches no goal) out of the
 * floor, and each part left that holds a box is a room. Null when some part holds more or fewer boxes than goals, or a
 * box starts in the hallway: then the level is no set of rooms. */
function roomsOf(level: Level): { boxes: number[]; goals: number[]; done: boolean }[] | null {
  const { w, wall, goals, boxes, player } = level;
  const live = liveSquares(level);
  const row = Math.floor(player / w);
  const cut = new Uint8Array(wall.length);
  for (let i = row * w; i < (row + 1) * w; i++) if (!wall[i] && !live[i]) cut[i] = 1;
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(wall.length).fill(-1);
  const rooms: { boxes: number[]; goals: number[]; done: boolean }[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const [dx, dy] of DIRS) {
        const q = squares[i]! + dy * w + dx;
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ boxes: [], goals: [], done: false });
  }
  for (const b of boxes) rooms[part[b]!]!.boxes.push(b);
  for (const g of goals) if (part[g]! >= 0) rooms[part[g]!]!.goals.push(g);
  if (goals.some((g) => part[g]! < 0) || rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/** Whether the box just pushed to `t` sits in a frozen 2x2 block of walls and boxes with a box off its goal. */
function frozenBlock(w: number, wall: Uint8Array, occupied: Uint8Array, goal: Uint8Array, t: number): boolean {
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1;
    const c = a + w;
    const d = c + 1;
    if (!(wall[a] || occupied[a]) || !(wall[b] || occupied[b]) || !(wall[c] || occupied[c]) || !(wall[d] || occupied[d])) continue;
    if ((occupied[a] && !goal[a]) || (occupied[b] && !goal[b]) || (occupied[c] && !goal[c]) || (occupied[d] && !goal[d])) return true;
  }
  return false;
}

/**
 * The push-optimal solution of `level`: {pushes, moves} (moves in LURD: a lower letter a step, an upper one a push),
 * or null when the search gives up. A* over pushes; the estimate is the cheapest assignment of boxes to goals over
 * walking distances (the exact optimum over permutations while the boxes are few, else each box to its nearest goal),
 * which never overestimates the pushes left, so the first solved state popped is push-optimal. `budget` counts the
 * states this call may keep, shared across the set's rooms; it is spent, never the clock.
 */
function solvePushOptimal(level: Level, maxStates: number, budget: { left: number }): { pushes: number; moves: string } | null {
  const { w, wall, goals } = level;
  const size = wall.length;
  const goal = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  const live = liveSquares(level);
  if (level.boxes.some((b) => !live[b])) return null;
  // Walking distance from each goal to every square: the estimate's table.
  const distFromGoal = goals.map((g) => distances(wall, w, g));
  const n = goals.length;
  const perms: number[][] = [];
  if (n <= 5) {
    const gen = (prefix: number[], rest: number[]): void => {
      if (rest.length === 0) {
        perms.push(prefix);
        return;
      }
      for (let i = 0; i < rest.length; i++) gen([...prefix, rest[i]!], rest.filter((_, j) => j !== i));
    };
    gen([], goals.map((_, i) => i));
  }
  const estimate = (boxes: number[]): number => {
    if (n <= 5) {
      let best = Infinity;
      for (const p of perms) {
        let s = 0;
        for (let i = 0; i < n; i++) {
          const d = distFromGoal[p[i]!]![boxes[i]!]!;
          if (d < 0) {
            s = Infinity;
            break;
          }
          s += d;
        }
        if (s < best) best = s;
      }
      return best;
    }
    let s = 0;
    for (const b of boxes) {
      let m = Infinity;
      for (const dg of distFromGoal) if (dg[b]! >= 0 && dg[b]! < m) m = dg[b]!;
      if (m === Infinity) return Infinity;
      s += m;
    }
    return s;
  };
  const solved = (boxes: number[]): boolean => boxes.every((b) => goal[b]);
  const keyOf = (boxes: number[], low: number): string => low + ':' + boxes.join(',');

  // The player's reachable region from `from` around walls and `occupied`, flood-filled into `seenArr` under `stamp`;
  // `prev`/`how` remember the walk that reached each square, so a push's walk can be read back. Returns the region's
  // lowest square. The expansion's region and a new state's region use separate stamp arrays: flooding one must never
  // re-stamp the other's squares.
  const seen = new Int32Array(size);
  const mark = new Int32Array(size);
  const prev = new Int32Array(size);
  const how = new Array<string>(size);
  const stack = new Int32Array(size);
  let seenStamp = 0;
  let markStamp = 0;
  const reach = (occupied: Uint8Array, from: number, seenArr: Int32Array, stamp: number): number => {
    let low = from;
    let sp = 0;
    stack[sp++] = from;
    seenArr[from] = stamp;
    prev[from] = from;
    while (sp > 0) {
      const p = stack[--sp]!;
      if (p < low) low = p;
      for (const [dx, dy, letter] of DIRS) {
        const q = p + dy * w + dx;
        if (!wall[q] && !occupied[q] && seenArr[q] !== stamp) {
          seenArr[q] = stamp;
          prev[q] = p;
          how[q] = letter;
          stack[sp++] = q;
        }
      }
    }
    return low;
  };
  // The shortest walk from `from` to `to` over the region the last reach() filled (the first direction first on ties).
  const walk = (from: number, to: number): string => {
    if (from === to) return '';
    let s = '';
    for (let p = to; p !== from; p = prev[p]!) s = how[p]! + s;
    return s;
  };

  // The states in the order found: their boxes, the player's square, their key, and the push that made them.
  const statesBoxes: number[][] = [level.boxes.slice()];
  const statesPlayer: number[] = [level.player];
  const statesG: number[] = [0];
  const statesKey: string[] = [''];
  const parent: number[] = [-1];
  const transFrom: number[] = [-1];
  const transLetter: string[] = [''];
  const best = new Map<string, number>();
  const occupied = new Uint8Array(size);
  for (const b of level.boxes) occupied[b] = 1;
  const startLow = reach(occupied, level.player, mark, ++markStamp);
  for (const b of level.boxes) occupied[b] = 0;
  statesKey[0] = keyOf(level.boxes, startLow);
  best.set(statesKey[0]!, 0);
  // The open list, a heap on (estimate + pushes, estimate, order found).
  const heap: number[] = [];
  const heapF: number[] = [];
  const heapH: number[] = [];
  const heapSeq: number[] = [];
  let seq = 0;
  const heapLess = (a: number, b: number): boolean =>
    heapF[a]! < heapF[b]! || (heapF[a]! === heapF[b]! && (heapH[a]! < heapH[b]! || (heapH[a]! === heapH[b]! && heapSeq[a]! < heapSeq[b]!)));
  const heapSwap = (a: number, b: number): void => {
    for (const arr of [heap, heapF, heapH, heapSeq]) {
      const t = arr[a]!;
      arr[a] = arr[b]!;
      arr[b] = t;
    }
  };
  const heapPush = (idx: number, f: number, h: number): void => {
    heap.push(idx);
    heapF.push(f);
    heapH.push(h);
    heapSeq.push(seq++);
    let j = heap.length - 1;
    while (j > 0) {
      const p = (j - 1) >> 1;
      if (!heapLess(j, p)) break;
      heapSwap(j, p);
      j = p;
    }
  };
  const heapPop = (): number => {
    const top = heap[0]!;
    const last = heap.length - 1;
    const li = heap[last]!;
    const lf = heapF[last]!;
    const lh = heapH[last]!;
    const ls = heapSeq[last]!;
    heap.pop();
    heapF.pop();
    heapH.pop();
    heapSeq.pop();
    if (heap.length > 0) {
      heap[0] = li;
      heapF[0] = lf;
      heapH[0] = lh;
      heapSeq[0] = ls;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heapLess(c + 1, c)) c++;
        if (!heapLess(c, i)) break;
        heapSwap(i, c);
        i = c;
      }
    }
    return top;
  };
  const h0 = estimate(level.boxes);
  if (h0 === Infinity) return null;
  heapPush(0, h0, h0);
  let found = solved(level.boxes) ? 0 : -1;
  let kept = 1;
  while (heap.length > 0 && found < 0) {
    const s = heapPop();
    if (best.get(statesKey[s]!) !== s) continue; // Stale: a cheaper path to this key was recorded since.
    const boxes = statesBoxes[s]!;
    const g = statesG[s]!;
    for (const b of boxes) occupied[b] = 1;
    reach(occupied, statesPlayer[s]!, seen, ++seenStamp);
    const here = seenStamp;
    for (let bi = 0; bi < boxes.length && found < 0; bi++) {
      const b = boxes[bi]!;
      for (const [dx, dy, , pushLetter] of DIRS) {
        const d = dy * w + dx;
        const t = b + d;
        if (seen[b - d] !== here || wall[t] || occupied[t] || !live[t]) continue;
        occupied[b] = 0;
        occupied[t] = 1;
        if (frozenBlock(w, wall, occupied, goal, t)) {
          occupied[t] = 0;
          occupied[b] = 1;
          continue;
        }
        const next = boxes.slice();
        next[bi] = t;
        next.sort((a, bb) => a - bb);
        const low = reach(occupied, b, mark, ++markStamp);
        const key = keyOf(next, low);
        const prevIdx = best.get(key);
        if (prevIdx !== undefined && statesG[prevIdx]! <= g + 1) {
          occupied[t] = 0;
          occupied[b] = 1;
          continue;
        }
        const h = estimate(next);
        occupied[t] = 0;
        occupied[b] = 1;
        if (h === Infinity) continue;
        if (kept >= maxStates || budget.left <= 0) return null;
        kept++;
        budget.left--;
        best.set(key, statesBoxes.length);
        statesBoxes.push(next);
        statesPlayer.push(b);
        statesG.push(g + 1);
        statesKey.push(key);
        parent.push(s);
        transFrom.push(b - d);
        transLetter.push(pushLetter);
        if (solved(next)) {
          found = statesBoxes.length - 1;
          break;
        }
        heapPush(statesBoxes.length - 1, g + 1 + h, h);
      }
    }
    for (const b of boxes) occupied[b] = 0;
  }
  if (found < 0) return null;
  // The path of states, then the moves: walk to each push's square (re-flooded from the parent's own position, since
  // the search's scratch arrays hold another state's region by now), then push.
  const path: number[] = [];
  for (let s = found; s > 0; s = parent[s]!) path.push(s);
  path.reverse();
  let moves = '';
  for (const s of path) {
    const p = parent[s]!;
    const pBoxes = statesBoxes[p]!;
    for (const b of pBoxes) occupied[b] = 1;
    reach(occupied, statesPlayer[p]!, seen, ++seenStamp);
    for (const b of pBoxes) occupied[b] = 0;
    moves += walk(statesPlayer[p]!, transFrom[s]!) + transLetter[s]!;
  }
  return { pushes: statesG[found]!, moves };
}

/** The square the player stands on after `moves` (LURD, the case aside) from `from` on a board `w` wide. */
function endOf(w: number, from: number, moves: string): number {
  let p = from;
  for (const ch of moves.toLowerCase()) p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  return p;
}

/**
 * The level solved room by room: each room's push-optimal solution in turn, the other rooms' boxes standing as walls
 * (on their goals once their room is done), the player walking on from where the last room left it. A box never leaves
 * its room, so the rooms' optima add up to the level's: {pushes, moves}, or null when a room's search gives up, or the
 * level is no set of rooms and the search over the whole level gives up.
 */
function solveByRooms(level: Level, budget: { left: number }): { pushes: number; moves: string } | null {
  const rooms = roomsOf(level);
  if (rooms === null) return solvePushOptimal(level, MAX_STATES_TOTAL, budget);
  let player = level.player;
  let pushes = 0;
  let moves = '';
  for (const room of rooms) {
    const wall = level.wall.slice();
    for (const other of rooms) {
      if (other === room) continue;
      for (const b of other.done ? other.goals : other.boxes) wall[b] = 1;
    }
    const sub: Level = {
      w: level.w,
      h: level.h,
      wall,
      goals: room.goals.slice().sort((a, b) => a - b),
      boxes: room.boxes.slice().sort((a, b) => a - b),
      player,
    };
    const solved = solvePushOptimal(sub, MAX_STATES_PER_ROOM, budget);
    if (solved === null) return null;
    pushes += solved.pushes;
    moves += solved.moves;
    player = endOf(level.w, player, solved.moves);
    room.done = true;
  }
  return { pushes, moves };
}

/** The moves for a level in XSB: a string of u, d, l and r (an upper letter marks a push; case is not checked). */
function solve(text: string): string {
  const level = parseLevel(text);
  if (level.boxes.length === 0) return '';
  const budget = { left: MAX_STATES_TOTAL };
  const byRooms = solveByRooms(level, budget);
  if (byRooms !== null) return byRooms.moves;
  const whole = solvePushOptimal(level, MAX_STATES_TOTAL, { left: MAX_STATES_TOTAL });
  return whole === null ? '' : whole.moves;
}

for (const id of readdirSync(I).sort()) {
  const moves = solve(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}

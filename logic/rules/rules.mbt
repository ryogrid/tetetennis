// Pure tennis scoring for a 1-set match. Ported from old/src/match.js.
// Players: P (human) and C (cpu).

///|
pub(all) enum Side {
  P
  C
} derive(Eq, Show)

///|
pub fn other(s : Side) -> Side {
  match s {
    P => C
    C => P
  }
}

///|
pub(all) enum PointEvent {
  Point
  Game
  TiebreakStart
  SetWon
} derive(Eq, Show)

///|
pub(all) struct Match {
  mut points_p : Int // 0..3 = 0/15/30/40, 4 = advantage
  mut points_c : Int
  mut games_p : Int
  mut games_c : Int
  mut tiebreak : Bool
  mut tb_points_p : Int
  mut tb_points_c : Int
  mut server : Side
  mut winner : Side?
  target_games : Int // games to win the set (win by 2, tiebreak at target-target)
}

///|
pub fn create_match(first_server : Side, target_games~ : Int = 6) -> Match {
  {
    points_p: 0,
    points_c: 0,
    games_p: 0,
    games_c: 0,
    tiebreak: false,
    tb_points_p: 0,
    tb_points_c: 0,
    server: first_server,
    winner: None,
    target_games,
  }
}

///|
fn get_points(m : Match, who : Side) -> Int {
  match who {
    P => m.points_p
    C => m.points_c
  }
}

///|
fn set_points(m : Match, who : Side, v : Int) -> Unit {
  match who {
    P => m.points_p = v
    C => m.points_c = v
  }
}

///|
fn get_games(m : Match, who : Side) -> Int {
  match who {
    P => m.games_p
    C => m.games_c
  }
}

///|
fn inc_games(m : Match, who : Side) -> Unit {
  match who {
    P => m.games_p = m.games_p + 1
    C => m.games_c = m.games_c + 1
  }
}

///|
fn get_tb(m : Match, who : Side) -> Int {
  match who {
    P => m.tb_points_p
    C => m.tb_points_c
  }
}

///|
fn inc_tb(m : Match, who : Side) -> Unit {
  match who {
    P => m.tb_points_p = m.tb_points_p + 1
    C => m.tb_points_c = m.tb_points_c + 1
  }
}

///|
fn win_game(m : Match, who : Side) -> PointEvent {
  inc_games(m, who)
  m.points_p = 0
  m.points_c = 0
  m.server = other(m.server)
  let lead = get_games(m, who) - get_games(m, other(who))
  if get_games(m, who) >= m.target_games && lead >= 2 {
    m.winner = Some(who)
    return SetWon
  }
  if m.games_p == m.target_games && m.games_c == m.target_games {
    m.tiebreak = true
    return TiebreakStart
  }
  Game
}

///|
pub fn add_point(m : Match, who : Side) -> PointEvent {
  if m.winner is Some(_) {
    return SetWon
  }
  if m.tiebreak {
    inc_tb(m, who)
    let a = get_tb(m, who)
    let b = get_tb(m, other(who))
    if a >= 7 && a - b >= 2 {
      inc_games(m, who) // 7-6
      m.winner = Some(who)
      return SetWon
    }
    // serve rotation: 1 point, then 2-2-2...: swap after odd totals
    if (m.tb_points_p + m.tb_points_c) % 2 == 1 {
      m.server = other(m.server)
    }
    return Point
  }
  let o = other(who)
  let pw = get_points(m, who)
  let po = get_points(m, o)
  if pw == 3 && po == 3 {
    set_points(m, who, 4) // deuce -> ad
    return Point
  }
  if po == 4 {
    set_points(m, o, 3) // back to deuce
    return Point
  }
  if pw >= 3 {
    return win_game(m, who) // wins game
  }
  set_points(m, who, pw + 1)
  Point
}

// Point index within the current game (for serve side: even = deuce side).
///|
pub fn point_number_in_game(m : Match) -> Int {
  if m.tiebreak {
    m.tb_points_p + m.tb_points_c
  } else {
    m.points_p + m.points_c
  }
}

///|
pub(all) struct ScoreStrings {
  games : String
  points : String
  server : Side
  winner : Side?
}

///|
let point_labels : Array[String] = ["0", "15", "30", "40"]

///|
pub fn score_strings(m : Match) -> ScoreStrings {
  let games = "\{m.games_p}-\{m.games_c}"
  let points = if m.tiebreak {
    "TB \{m.tb_points_p}-\{m.tb_points_c}"
  } else if m.points_p >= 3 && m.points_c >= 3 {
    if m.points_p == m.points_c {
      "Deuce"
    } else if m.points_p > m.points_c {
      "Ad P"
    } else {
      "Ad C"
    }
  } else {
    "\{point_labels[m.points_p]}-\{point_labels[m.points_c]}"
  }
  { games, points, server: m.server, winner: m.winner }
}

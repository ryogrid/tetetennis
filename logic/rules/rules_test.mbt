// Ported 1:1 from old/tests/match.test.js.

///|
fn win_points(m : Match, who : Side, n : Int) -> PointEvent {
  let mut ev : PointEvent = Point
  for _i = 0; _i < n; _i = _i + 1 {
    ev = add_point(m, who)
  }
  ev
}

///|
test "love to game in four points" {
  let m = create_match(P)
  assert_eq(win_points(m, P, 3), Point)
  assert_eq(score_strings(m).points, "40-0")
  assert_eq(add_point(m, P), Game)
  assert_eq(m.games_p, 1)
  assert_eq(m.server, C)
}

///|
test "deuce and advantage cycling" {
  let m = create_match(P)
  win_points(m, P, 3) |> ignore
  win_points(m, C, 3) |> ignore
  assert_eq(score_strings(m).points, "Deuce")
  add_point(m, P) |> ignore
  assert_eq(score_strings(m).points, "Ad P")
  add_point(m, C) |> ignore
  assert_eq(score_strings(m).points, "Deuce")
  add_point(m, C) |> ignore
  assert_eq(score_strings(m).points, "Ad C")
  assert_eq(add_point(m, C), Game)
  assert_eq(m.games_c, 1)
}

///|
test "serve alternates each game" {
  let m = create_match(P)
  win_points(m, P, 4) |> ignore
  assert_eq(m.server, C)
  win_points(m, P, 4) |> ignore
  assert_eq(m.server, P)
}

///|
test "set won at 6 games with 2 clear" {
  let m = create_match(P)
  for _i = 0; _i < 5; _i = _i + 1 {
    win_points(m, P, 4) |> ignore
  }
  assert_eq(m.winner, None)
  assert_eq(win_points(m, P, 4), SetWon)
  assert_eq(m.winner, Some(P))
}

///|
test "configurable set length: a 2-game set is won at 2-0" {
  let m = create_match(P, target_games=2)
  win_points(m, P, 4) |> ignore // 1-0
  assert_eq(m.winner, None)
  assert_eq(win_points(m, P, 4), SetWon) // 2-0
  assert_eq(m.winner, Some(P))
}

///|
test "configurable set length: a 6-game set is not won at 2-0" {
  let m = create_match(P, target_games=6)
  win_points(m, P, 4) |> ignore
  win_points(m, P, 4) |> ignore // 2-0
  assert_eq(m.winner, None)
}

///|
test "no set win at 6-5; tiebreak starts at 6-6" {
  let m = create_match(P)
  for _i = 0; _i < 5; _i = _i + 1 {
    win_points(m, P, 4) |> ignore
    win_points(m, C, 4) |> ignore
  }
  assert_eq(win_points(m, P, 4), Game) // 6-5
  assert_eq(m.winner, None)
  assert_eq(win_points(m, C, 4), TiebreakStart) // 6-6
  assert_eq(m.tiebreak, true)
}

///|
test "tiebreak to 7 with 2 clear, 7-6 final games" {
  let m = create_match(P)
  for _i = 0; _i < 6; _i = _i + 1 {
    win_points(m, P, 4) |> ignore
    win_points(m, C, 4) |> ignore
  }
  assert_eq(m.tiebreak, true)
  win_points(m, P, 6) |> ignore
  win_points(m, C, 6) |> ignore // 6-6 in TB
  assert_eq(m.winner, None)
  add_point(m, P) |> ignore // 7-6: not enough
  assert_eq(m.winner, None)
  assert_eq(add_point(m, P), SetWon) // 8-6
  assert_eq(m.winner, Some(P))
  assert_eq(m.games_p, 7)
  assert_eq(m.games_c, 6)
}

///|
test "tiebreak serve rotation: 1 then 2-2-2" {
  let m = create_match(P)
  for _i = 0; _i < 6; _i = _i + 1 {
    win_points(m, P, 4) |> ignore
    win_points(m, C, 4) |> ignore
  }
  let first = m.server
  let seq = [first]
  for i = 0; i < 5; i = i + 1 {
    add_point(m, if i % 2 == 0 { P } else { C }) |> ignore
    seq.push(m.server)
  }
  // pattern: X Y Y X X Y
  assert_true(seq[1] != seq[0])
  assert_eq(seq[2], seq[1])
  assert_true(seq[3] != seq[2])
  assert_eq(seq[4], seq[3])
  assert_true(seq[5] != seq[4])
}

///|
test "point parity for serve side, including deuce cycles" {
  let m = create_match(P)
  assert_eq(point_number_in_game(m) % 2, 0) // first point: deuce side
  add_point(m, P) |> ignore
  assert_eq(point_number_in_game(m) % 2, 1) // ad side
  win_points(m, P, 2) |> ignore
  win_points(m, C, 3) |> ignore // deuce (6 points played)
  assert_eq(point_number_in_game(m) % 2, 0)
  add_point(m, P) |> ignore // advantage (7 points)
  assert_eq(point_number_in_game(m) % 2, 1)
  add_point(m, C) |> ignore // back to deuce
  assert_eq(point_number_in_game(m) % 2, 0)
}

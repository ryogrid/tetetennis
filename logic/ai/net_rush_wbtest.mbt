// Whitebox tests for internal AI helpers (sees private functions).

///|
test "net rush: short slow balls draw a net-lover in; deep or fast ones don't" {
  // pred_z magnitude is the strike point's distance from the net
  assert_true(should_rush_net(58.0, 4.0, 12.0)) // net-lover, short slow ball -> rush
  assert_true(!should_rush_net(22.0, 4.0, 12.0)) // grinder stays back on a mid ball
  assert_true(should_rush_net(22.0, 1.0, 12.0)) // ...but pounces a very short ball
  assert_true(!should_rush_net(58.0, 4.0, 45.0)) // a fast (serve-pace) ball is no chance
  assert_true(!should_rush_net(58.0, 11.0, 12.0)) // a deep ball is never a rush
}

///|
test "AI out tolerance: in balls always played; hard judges borderline outs best" {
  assert_true(out_letgo_prob("normal", -0.5) == 0.0) // an in ball is always played
  assert_true(out_letgo_prob("hard", 1.0) > 0.9) // a clear out is let go
  // on a borderline out, hard lets it go more often (better judgement) than easy
  assert_true(out_letgo_prob("hard", 0.3) > out_letgo_prob("easy", 0.3))
}

///|
test "AI tactical shots: lob a net-rusher, drop a deep camper, else neither" {
  // human at the net (z=3): a winning roll -> Lob, a losing roll -> None
  assert_true(tactical_shot_type(3.0, 0.1, "hard") == Some(Lob))
  assert_true(tactical_shot_type(3.0, 0.95, "hard") == None)
  // human camped deep (z=14): Drop
  assert_true(tactical_shot_type(14.0, 0.1, "hard") == Some(Drop))
  // human at a normal baseline depth (z=8): never a tactical override
  assert_true(tactical_shot_type(8.0, 0.1, "hard") == None)
}

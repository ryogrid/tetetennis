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

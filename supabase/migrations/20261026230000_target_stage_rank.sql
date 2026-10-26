-- Recording a booked call inserts acq_targets. The guard trigger calls
-- acq_stage_rank, which was revoked from authenticated, so the insert
-- failed with permission denied. The function only ranks a stage name.
grant execute on function public.acq_stage_rank(text) to authenticated;

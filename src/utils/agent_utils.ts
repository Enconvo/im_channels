import { NativeAPI, NativeEventUtils } from "@enconvo/api";

export async function updateAgentRunningStatus(params: { commandKey: string, status: 'running' | 'completed' | 'failed' }) {
    await NativeAPI.api("search/upsert_command", {
        commandKey: params.commandKey,
        updateFields: { run_status: params.status },
    });
    NativeEventUtils.sendEvent("run_status_changed", { commandKey: params.commandKey, runStatus: params.status }).catch(() => { });
}


export async function getAgentRunningStatus(params: { sessionId: string }) {
    // Check if this session's agent is already running (skip for sub-agents)
    const agentStatusResp = await NativeAPI.api('agent/check_agent_status', { sessionId: params.sessionId })
    const agentStatusData = await agentStatusResp.json()
    // console.log('agentStatusData', agentStatusData)
    const runningStatus = agentStatusData?.run_status
    return runningStatus as 'running' | 'completed' | 'failed'
}
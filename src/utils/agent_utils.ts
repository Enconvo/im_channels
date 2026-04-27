import { NativeAPI } from "@enconvo/api";

export type AgentRunStatus = "idle" | "running" | "completed" | "failed";

export namespace AgentUtils {
    export async function updateRunningStatus(params: { sessionId: string; status: AgentRunStatus }) {
        const response = await NativeAPI.localApi("agent/session/update", {
            sessionId: params.sessionId,
            runStatus: params.status,
        });
        const data = await response.json();
        console.log('updateRunningStatus', data, {
            sessionId: params.sessionId,
            runStatus: params.status,
        })
    }

    export async function getRunningStatus(params: { sessionId: string }): Promise<AgentRunStatus | undefined> {
        const response = await NativeAPI.localApi("agent/session/status", { sessionId: params.sessionId });
        const data = await response.json();
        console.log('getRunningStatus', data)
        return data?.run_status as AgentRunStatus | undefined;
    }
}

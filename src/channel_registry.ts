import { CommandManageUtils, NativeAPI, IMChannelProvider, ServiceProvider } from "@enconvo/api";

interface DiscoveredProvider {
    name: string;
    commandKey: string;
    extensionName: string;
    targetCommand: string | null;
    title: string;
}

let initializedProviders: IMChannelProvider[] | null = null;

async function discoverProviderCommands(): Promise<DiscoveredProvider[]> {
    const results = (await NativeAPI.localApi("search/providers", {
        category: "im_channel",
    } as any).then(r => r.json())) as any[];

    if (!Array.isArray(results)) return [];

    return results.map((item: any) => ({
        name: item.name,
        commandKey: item.commandKey,
        extensionName: item.extensionName,
        targetCommand: item.targetCommand || null,
        title: item.title,
    }));
}

export async function loadProviders(): Promise<IMChannelProvider[]> {
    if (initializedProviders) return initializedProviders;

    const providers: IMChannelProvider[] = [];
    const commands = await discoverProviderCommands();

    for (const cmd of commands) {
        try {
            const config = await CommandManageUtils.loadCommandConfig({
                commandKey: cmd.commandKey,
                decrypt: true,
            }) as Record<string, any> | null;
            if (!config) continue;

            // Ensure ServiceProvider.load can find the JS file
            config.commandKey = cmd.commandKey;
            if (cmd.targetCommand) {
                config.targetCommand = cmd.targetCommand;
            }

            const provider: IMChannelProvider = ServiceProvider.load(config);

            if (provider.isReady()) {
                providers.push(provider);
            }
        } catch (err: any) {
            console.error(`[IM registry] Failed to load provider ${cmd.commandKey}:`, err.message);
        }
    }

    initializedProviders = providers;
    return providers;
}

export function getLoadedProviders(): IMChannelProvider[] {
    return initializedProviders || [];
}

export function getProvider(name: string): IMChannelProvider | undefined {
    return (initializedProviders || []).find((p) => p.name === name);
}

export async function hasAnyChannelConfigured(): Promise<boolean> {
    const providers = await loadProviders();
    return providers.length > 0;
}

export async function destroyAllProviders(): Promise<void> {
    if (!initializedProviders) return;
    for (const provider of initializedProviders) {
        await provider.destroy();
    }
    initializedProviders = null;
}

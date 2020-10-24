import * as types from './types';

export const serverVersion = '0.2.0-beta';
export const serverProtocol = 2;

export interface IServerConfig {
	port: number;
	address: string;
	name: string;
	motd: string;
	public: boolean;
	maxplayers: number;
	chunkTransportCompression: boolean;
	connect: {
		address: string;
		port: number;
	};
}

export const serverDefaultConfig: IServerConfig = {
	port: 3001,
	address: '0.0.0.0',
	name: 'MCServer',
	motd: 'Another Minecraft2VoxelSRV proxy',
	public: false,
	maxplayers: 10,
	chunkTransportCompression: false,
	connect: {
		address: "localhost",
		port: 25565
	}
};

export let serverConfig: IServerConfig = serverDefaultConfig;

export function setConfig(config: object) {
	serverConfig = { ...serverDefaultConfig, ...config };
}

export const invalidNicknameRegex = new RegExp('[^a-zA-Z0-9_]');

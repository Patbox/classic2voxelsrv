import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as zlib from 'zlib';

import * as configs from './lib/configs';

import startHeartbeat from './lib/heartbeat';

import { serverVersion, serverProtocol, serverConfig, setConfig, serverDefaultConfig } from './values';
import { BaseSocket } from './socket';
import * as console from './lib/console';
import {
	IActionClick,
	IActionInventoryClick,
	IActionBlockBreak,
	IActionBlockPlace,
	IActionClickEntity,
	IActionMessage,
	IActionMove,
	ILoginResponse,
	IActionLook,
	IActionMoveLook,
} from 'voxelsrv-protocol/js/client';

import ndarray = require('ndarray');
import { IPlayerEntity, IPlayerTeleport, IWorldChunkLoad } from 'voxelsrv-protocol/js/server';

const minecraft = require('minecraft-classic-protocol');
const mcData = require('minecraft-data')('0.30c');

const blockRegistry: { [index: string]: any } = {};
const itemRegistry: { [index: string]: any } = {};

mcData.blocksArray.forEach((block: any) => {
	const id = replaceAll(block.name, ' ', '_');
	blockRegistry[id] = {
		rawid: block.id,
		id: id,
		texture: ['block/' + id.replace('cloth', 'wool')],
		options: {},
		hardness: 1,
		miningtime: 0,
		tool: 'pickaxe',
		type: 0,
		unbreakable: block.diggable,
	};

	itemRegistry[id] = {
		id: id,
		name: block.displayName,
		texture: 'block/' + id.replace('cloth', 'wool'),
		type: 'ItemBlock',
		block: block.id,
		flat: true,
	};
});

blockRegistry['grass_block'].texture = ['block/grass_top', 'block/dirt', 'block/grass_side'];
itemRegistry['grass_block'].texture = 'block/grass_side';

blockRegistry['wood_planks'].texture = ['block/birch_planks'];
itemRegistry['wood_planks'].texture = 'block/birch_planks';

blockRegistry['sapling'].texture = ['block/oak_sapling'];
itemRegistry['sapling'].texture = 'block/oak_sapling';

blockRegistry['brick'].texture = ['block/bricks'];
itemRegistry['brick'].texture = 'block/bricks';

blockRegistry['wood'].texture = ['block/log_top', 'block/log'];
itemRegistry['wood'].texture = 'block/log';

blockRegistry['rose'].texture = ['block/red_flower'];
itemRegistry['rose'].texture = 'block/red_flower';

blockRegistry['aqua_green_cloth'].texture = ['block/light_blue_concrete'];
itemRegistry['aqua_green_cloth'].texture = 'block/light_blue_concrete';

blockRegistry['indigo_cloth'].texture = ['block/purple_concrete'];
itemRegistry['indigo_cloth'].texture = 'block/purple_concrete';

blockRegistry['violet_cloth'].texture = ['block/purple_concrete'];
itemRegistry['violet_cloth'].texture = 'block/purple_concrete';

blockRegistry['block_of_gold'].texture = ['block/gold_block'];
itemRegistry['block_of_gold'].texture = 'block/gold_block';

blockRegistry['block_of_iron'].texture = ['block/iron_block'];
itemRegistry['block_of_iron'].texture = 'block/iron_block';

blockRegistry['double_slab'].texture = ['block/smooth_stone', 'block/smooth_stone_slab_side'];
itemRegistry['double_slab'].texture = 'block/smooth_stone_slab_side';

blockRegistry['slab'].texture = ['block/smooth_stone', 'block/smooth_stone_slab_side'];
itemRegistry['slab'].texture = 'block/smooth_stone_slab_side';

blockRegistry['tnt'].texture = ['block/tnt_top', 'bloc/tnt_bottom', 'block/tnt_side'];
itemRegistry['tnt'].texture = 'block/tnt_side';

blockRegistry['bookshelf'].texture = ['block/oak_planks', 'bloc/bookshelf'];
itemRegistry['bookshelf'].texture = 'block/bookshelf';

blockRegistry['moss_stone'].texture = ['block/mossy_cobblestone'];
itemRegistry['moss_stone'].texture = 'block/mossy_cobblestone';

itemRegistry['flowing_lava'].texture = 'item/lava_bucket';
itemRegistry['stationary_lava'].texture = 'item/lava_bucket';

itemRegistry['flowing_water'].texture = 'item/water_bucket';
itemRegistry['stationary_water'].texture = 'item/water_bucket';

['sapling', 'dandelion', 'rose', 'brown_mushroom', 'red_mushroom'].forEach((x) => {
	blockRegistry[x].options = { solid: false, opaque: false };
});

['flowing_water', 'stationary_water'].forEach((x) => {
	blockRegistry[x].options = { fluid: true, material: 'water' };
});

['flowing_lava', 'stationary_lava'].forEach((x) => {
	blockRegistry[x].options = { fluid: true, color: [0.6, 0.1, 0.1, 0.7] };
	delete blockRegistry[x].texture
});

['glass', 'leaves'].forEach((x) => {
	blockRegistry[x].options = { opaque: false };
});

['sapling', 'dandelion', 'rose', 'brown_mushroom', 'red_mushroom'].forEach((x) => {
	blockRegistry[x].type = 1;
});

const colormap = {
	'1': 'blue',
	'2': 'green',
	'3': 'cyan',
	'4': 'red',
	'5': 'purple',
	'6': 'orange',
	'7': 'lightgray',
	'8': 'gray',
	'9': 'indigo',
	a: 'lime',
	b: 'lightblue',
	c: 'lightred',
	d: 'magenta',
	e: 'yellow',
	f: 'white',
};

function invItems() {
	const items = {};
	let x;

	for (x = 0; x < mcData.blocksArray.length; x++) {
		items[x] = {
			id: replaceAll(mcData.blocksArray[x].name, ' ', '_'),
			count: 1,
			data: {},
		};
	}
	return items;
}

function remapPitch(n) {
	// Head
	let x = Math.floor((n / 6.29) * 255) + 0;
	if (0 > x) x = x + 255;

	return x;
}

function remapYaw(n) {
	// Rotation
	let x = Math.floor((n / 6.29) * 255) + 64;
	if (x > 255) x = x - 255;

	return x;
}

function replaceAll(text: string, toRep: string, out: string): string {
	let x1 = text;
	let x2 = text.replace(toRep, out);
	while (x1 != x2) {
		x1 = x2;
		x2 = x1.replace(toRep, out);
	}
	return x1;
}

delete blockRegistry['air'];

const movement = {
	airJumps: 999,
	airMoveMult: 0.5,
	crouch: false,
	crouchMoveMult: 0.8,
	jumpForce: 6,
	jumpImpulse: 8.5,
	jumpTime: 500,
	jumping: false,
	maxSpeed: 7.5,
	moveForce: 30,
	responsiveness: 15,
	running: false,
	runningFriction: 0,
	sprint: false,
	sprintMoveMult: 1.2,
	standingFriction: 2,
};

let server: Server;

export function getServerInstance(): Server {
	return server;
}

export function startServer(): Server {
	server = new Server();
	return server;
}

class Server extends EventEmitter {
	playerCount: number = 0;
	players: { [index: string]: BaseSocket } = {};
	constructor() {
		super();
		this.startServer();
	}

	private async startServer() {
		console.log(`^yStarting VoxelSRV server version^: ${serverVersion} ^y[Protocol:^: ${serverProtocol}^y]`);
		['./config'].forEach((element) => {
			if (!fs.existsSync(element)) {
				try {
					fs.mkdirSync(element);
					console.log(`^BCreated missing directory: ^w${element}`);
				} catch (e) {
					console.log(`^rCan't create directory: ^w${element}! Reason: ${e}`);
					process.exit();
				}
			}
		});
		//import('./lib/console-exec');

		const config = { ...serverDefaultConfig, ...configs.load('', 'config') };
		setConfig(config);
		configs.save('', 'config', config);

		this.emit('config-update', config);

		if (serverConfig.public) startHeartbeat();

		console.log('^yServer started on port: ^:' + serverConfig.port);
	}

	async connectPlayer(socket: BaseSocket) {
		socket.send('LoginRequest', {
			name: serverConfig.name,
			motd: serverConfig.motd,
			protocol: serverProtocol,
			maxplayers: serverConfig.maxplayers,
			numberplayers: this.playerCount,
			software: `classic2voxelsrv`,
		});

		let loginTimeout = true;

		socket.on('LoginResponse', (data: ILoginResponse) => {
			loginTimeout = false;
			let world: Buffer = null;
			let tempWorld: Buffer = null;
			let canMove = false;
			let worldPackets = [];
			const entities = {};
			let playerData = {
				x: 0,
				y: 0,
				z: 0,
				rotation: 0,
				pitch: 0
			};
			let inventory = {
				items: invItems(),
				size: mcData.blocksArray.length,
				tempslot: {},
				selected: 0,
			};

			const player = minecraft.createClient({
				host: serverConfig.connect.address,
				port: serverConfig.connect.port,
				username: data.username,
			});

			player.on('packet', async (d, m) => {
				//console.obj(d, m);
			});

			player.on('error', (e) => {
				console.error(e);
			});

			socket.send('PlayerHealth', {
				value: 0,
			});

			socket.send('PlayerEntity', { uuid: '0' });

			socket.on('close', () => {
				player.end();
			});
			socket.on('ActionMessage', (data: IActionMessage) => {
				player.write('message', { message: data.message });
			});

			socket.on('ActionBlockBreak', (data: IActionBlockBreak) => {
				player.write('set_block', { x: data.z, y: data.y, z: data.x, mode: 0 });
			});

			socket.on('ActionBlockPlace', (data: IActionBlockPlace) => {
				if (inventory.items[inventory.selected] == undefined) return;
				const block = blockRegistry[inventory.items[inventory.selected].id];
				if (block != undefined) player.write('set_block', { x: data.z, y: data.y, z: data.x, block_type: block.rawid, mode: 1 });
			});

			socket.on('ActionInventoryClick', (data: IActionInventoryClick) => {
				if (data.type == 'select') {
					inventory.selected = data.slot;
				} else {
					let temp1 = inventory.tempslot;
					let temp2 = inventory.items[data.slot];

					inventory.items[data.slot] = temp1;
					inventory.tempslot = temp2;

					socket.send('PlayerSlotUpdate', {
						slot: -1,
						data: JSON.stringify(inventory.tempslot),
						type: 'temp',
					});

					socket.send('PlayerSlotUpdate', {
						slot: data.slot,
						data: JSON.stringify(inventory.items[data.slot]),
						type: 'main',
					});
				}
			});

			socket.on('ActionMove', async (data: IActionMove) => {
				if (!canMove) return;

				playerData = {...playerData, ...data};

				player.write('position', {
					x: data.z * 32,
					y: data.y * 32 + 51,
					z: data.x * 32,
					yaw: remapYaw(playerData.rotation),
					pitch: remapPitch(playerData.pitch),
				});
			});

			socket.on('ActionMoveLook', async (data: IActionMoveLook) => {
				if (!canMove) return;

				playerData = {...playerData, ...data};

				player.write('position', {
					x: data.z * 32,
					y: data.y * 32 + 51,
					z: data.x * 32,
					yaw: remapYaw(data.rotation),
					pitch: remapPitch(data.pitch),
				});
			});
			socket.on('ActionLook', async (data: IActionLook) => {
				if (!canMove) return;

				playerData = {...playerData, ...data};

				player.write('position', {
					x: playerData.z * 32,
					y: playerData.y * 32 + 51,
					z: playerData.x * 32,
					yaw: remapYaw(data.rotation),
					pitch: remapPitch(data.pitch),
				});
			});

			socket.on('ActionClick', (data: IActionClick) => {});

			socket.on('ActionClickEntity', (data: IActionClickEntity) => {});

			player.on('message', (d) => {
				const text: string[] = d.message.split(/(&[0-9a-fA-F])/);

				const msg = [{ text: '', color: 'white' }];
				let x = 0;
				for (x = 0; x < text.length; x++) {
					if (text[x] == undefined) continue;
					else if (text[x][0] == '&' && /([kmobnr])/.test(text[x][1])) continue;
					else if (text[x][0] == '&' && /([0-9a-fA-F])/.test(text[x][1])) {
						msg.push({ text: '', color: colormap[text[x][1]] });
					} else {
						msg[msg.length - 1].text = msg[msg.length - 1].text + text[x];
					}
				}

				socket.send('ChatMessage', { message: msg });
			});

			player.on('spawn_player', (d) => {
				if (d.player_id == 255 || d.player_id == -1) {
					socket.send('LoginSuccess', {
						xPos: d.z / 32,
						yPos: d.y / 32,
						zPos: d.x / 32,
						inventory: JSON.stringify(inventory),
						blocksDef: JSON.stringify(blockRegistry),
						itemsDef: JSON.stringify(itemRegistry),
						armor: JSON.stringify({
							items: {},
							selected: 0,
							size: 0,
						}),
						allowCheats: false,
						allowCustomSkins: true,
						movement: JSON.stringify(movement),
					});

					socket.send('PlayerEntity', { uuid: `player${d.player_id.toString()}` });

					const data: IPlayerTeleport = {
						x: d.z / 32,
						y: d.y / 32,
						z: d.x / 32,
					};
					socket.send('PlayerTeleport', data);
					worldPackets.forEach((p) => socket.send('WorldChunkLoad', p));

					setTimeout(() => {
						canMove = true;
					}, 100);
				} else {
					setTimeout(() => {
						socket.send('EntityCreate', {
							uuid: `player${d.player_id.toString()}`,
							data: JSON.stringify({
								position: [0, 0, 0],
								model: 'player',
								texture: 'entity/steve',
								type: 'player',
								nametag: true,
								name: d.player_name,
								maxHealth: 20,
								health: 20,
								rotation: 1,
								pitch: 1,
								hitbox: [0.55, 1.9, 0.55],
								armor: { items: { 0: {}, 1: {}, 2: {}, 3: {} }, size: 4, selected: 0 },
							}),
						});
					}, 100);

					entities[d.player_id] = {
						id: `player${d.player_id.toString()}`,
						x: d.x,
						y: d.y,
						z: d.z,
						name: d.player_name,
					};
				}
			});

			player.on('despawn_player', (d) => {
				socket.send('EntityRemove', { uuid: d.player_id.toString() });
			});

			player.on('position_update', (d) => {
				entities[d.player_id].x = entities[d.player_id].x + d.change_in_x;
				entities[d.player_id].y = entities[d.player_id].y + d.change_in_y;
				entities[d.player_id].z = entities[d.player_id].z + d.change_in_z;

				socket.send('EntityMove', {
					uuid: entities[d.player_id].id,
					x: entities[d.player_id].z / 32,
					y: (entities[d.player_id].y - 51) / 32,
					z: entities[d.player_id].x / 32,
					rotation: (entities[d.player_id].rotation - 64) / 255 * 6.28,
					yaw: entities[d.player_id].yaw / 255 * 6.28,
				});
			});

			player.on('position_and_orientation_update', (d) => {
				entities[d.player_id].x = entities[d.player_id].x + d.change_in_x;
				entities[d.player_id].y = entities[d.player_id].y + d.change_in_y;
				entities[d.player_id].z = entities[d.player_id].z + d.change_in_z;
				entities[d.player_id].rotation = d.yaw;
				entities[d.player_id].yaw = d.pitch;

				socket.send('EntityMove', {
					uuid: entities[d.player_id].id,
					x: entities[d.player_id].z / 32,
					y: (entities[d.player_id].y - 51) / 32,
					z: entities[d.player_id].x / 32,
					rotation: (entities[d.player_id].rotation - 64) / 255 * 6.28,
					yaw: entities[d.player_id].yaw / 255 * 6.28,
				});
			});

			player.on('orientation_update', (d) => {
				entities[d.player_id].rotation = d.yaw;
				entities[d.player_id].yaw = d.pitch;

				socket.send('EntityMove', {
					uuid: entities[d.player_id].id,
					x: entities[d.player_id].z / 32,
					y: (entities[d.player_id].y - 51) / 32,
					z: entities[d.player_id].x / 32,
					rotation: (entities[d.player_id].rotation - 64) / 255 * 6.28,
					yaw: entities[d.player_id].yaw / 255 * 6.28
				});
			});

			player.on('player_teleport', (d) => {
				if (d.player_id == 255 || d.player_id == -1) {
					socket.send('PlayerTeleport', {
						x: d.z / 32,
						y: d.y / 32,
						z: d.x / 32,
					});
				} else {
					entities[d.player_id].x = d.x;
					entities[d.player_id].y = d.y;
					entities[d.player_id].z = d.z;

					socket.send('EntityMove', {
						uuid: entities[d.player_id].id,
						x: entities[d.player_id].z / 32,
						y: (entities[d.player_id].y - 51) / 32,
						z: entities[d.player_id].x / 32,
						rotation: (entities[d.player_id].rotation - 64) / 255 * 6.28,
						yaw: entities[d.player_id].yaw / 3.14,
					});
				}
			});

			player.on('disconnect', () => {
				socket.close();
			});

			player.on('set_block', (d) => {
				socket.send('WorldBlockUpdate', { x: d.z, y: d.y, z: d.x, id: d.block_type });
			});

			player.on('disconnect_player', (d) => {
				socket.send('PlayerKick', { reason: d.disconnect_reason });
				socket.close();
			});

			player.on('level_initialize', (d) => {
				tempWorld = Buffer.alloc(0);
				world = null;
				worldPackets = [];
			});

			player.on('level_data_chunk', (d) => {
				tempWorld = Buffer.concat([tempWorld, d.chunk_data]);
			});

			player.on('level_finalize', (d) => {
				world = zlib.gunzipSync(tempWorld);

				let i, j, k;

				let i2 = Math.ceil(d.x_size / 32);
				let j2 = Math.ceil(d.y_size / 32);
				let k2 = Math.ceil(d.z_size / 32);

				for (i = 0; i < i2; i++) {
					for (j = 0; j < j2; j++) {
						for (k = 0; k < k2; k++) {
							const chunk = new ndarray(new Uint16Array(32 * 32 * 32), [32, 32, 32]);

							let x, y, z;
							for (x = 0; x < 32; x++) {
								for (y = 0; y < 32; y++) {
									for (z = 0; z < 32; z++) {
										const index = 4 + x + 32 * i + d.z_size * (z + k * 32 + d.x_size * (y + 32 * j));
										if (index < world.length) chunk.set(z, y, x, world.readUInt8(index));
									}
								}
							}

							const data: IWorldChunkLoad = {
								x: k,
								y: j,
								z: i,
								data: Buffer.from(chunk.data.buffer, chunk.data.byteOffset),
								type: false,
								compressed: false,
							};

							worldPackets.push(data);
						}
					}
				}
			});
		});

		setTimeout(() => {
			if (loginTimeout == true) {
				socket.send('PlayerKick', { reason: 'Timeout!' });
				socket.close();
			}
		}, 10000);
	}
}

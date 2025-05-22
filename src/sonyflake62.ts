const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// Sonyflake generator
class Sonyflake {
	private static readonly EPOCH = 1288834974657; // 2010-11-04 01:42:54.657
	private static readonly SEQUENCE_BITS = 12;
	private static readonly MACHINE_ID_BITS = 10;
	private static readonly MAX_SEQUENCE = (1 << Sonyflake.SEQUENCE_BITS) - 1;
	private static readonly MAX_MACHINE_ID = (1 << Sonyflake.MACHINE_ID_BITS) - 1;

	private sequence = 0;
	private lastTimestamp = -1;
	private machineId: number;

	constructor(machineId: number) {
		if (machineId < 0 || machineId > Sonyflake.MAX_MACHINE_ID) {
			throw new Error(
				`Machine ID must be between 0 and ${Sonyflake.MAX_MACHINE_ID}`,
			);
		}
		this.machineId = machineId;
	}

	nextId(): bigint {
		let timestamp = Date.now();
		if (timestamp < this.lastTimestamp) {
			throw new Error("Invalid system clock");
		}

		if (timestamp === this.lastTimestamp) {
			this.sequence = (this.sequence + 1) & Sonyflake.MAX_SEQUENCE;
			if (this.sequence === 0) {
				timestamp = this.waitNextMillis(timestamp);
			}
		} else {
			this.sequence = 0;
		}

		this.lastTimestamp = timestamp;
		const id =
			(BigInt(timestamp - Sonyflake.EPOCH) <<
				BigInt(Sonyflake.SEQUENCE_BITS + Sonyflake.MACHINE_ID_BITS)) |
			(BigInt(this.machineId) << BigInt(Sonyflake.SEQUENCE_BITS)) |
			BigInt(this.sequence);
		return id;
	}

	toBase62(num: bigint): string {
		if (num === 0n) return "0";
		let result = "";
		let n = num;
		while (n > 0n) {
			result = BASE62[Number(n % 62n)] + result;
			n = n / 62n;
		}
		return result;
	}
	
	private waitNextMillis(timestamp: number): number {
		let nextTimestamp = Date.now();
		while (nextTimestamp <= timestamp) {
			nextTimestamp = Date.now();
		}
		return nextTimestamp;
	}
}

// Initialize Sonyflake with a random machine ID
export const sonyflake = new Sonyflake(Math.floor(Math.random() * 1024));

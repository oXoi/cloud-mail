import orm from '../entity/orm';
import verifyRecord from '../entity/verify-record';
import { eq, sql, and } from 'drizzle-orm';
import dayjs from 'dayjs';
import reqUtils from '../utils/req-utils';
import { verifyRecordType } from '../const/entity-const';

const verifyRecordService = {

	async selectByIPAndType(c, type) {
		const ip = reqUtils.getIp(c);
		return orm(c).select().from(verifyRecord).where(and(eq(verifyRecord.ip, ip), eq(verifyRecord.type, type))).get();
	},

	async selectListByIP(c) {
		const ip = reqUtils.getIp(c)
		return orm(c).select().from(verifyRecord).where(eq(verifyRecord.ip, ip)).all();
	},

	async clearRecord(c) {
		await orm(c).delete(verifyRecord).run();
	},

	async isOpenRegVerify(c, regVerifyCount) {

		const row = await this.selectByIPAndType(c, verifyRecordType.REG);

		if (row) {
			if (row.count >= regVerifyCount){
				return true
			}

		}

		return false

	},

	async isOpenAddVerify(c, addVerifyCount) {

		const row = await this.selectByIPAndType(c, verifyRecordType.ADD);

		if (row) {

			if (row.count >= addVerifyCount){
				return true
			}

		}

		return false

	},

	async increaseRegCount(c) {

		const ip = reqUtils.getIp(c)
		const row = await this.selectByIPAndType(c, verifyRecordType.REG);
		const now = dayjs().format('YYYY-MM-DD HH:mm:ss');

		if (row) {
			return  orm(c).update(verifyRecord).set({
				count: sql`${verifyRecord.count}
		+ 1`, updateTime: now
			}).where(and(eq(verifyRecord.ip, ip),eq(verifyRecord.type,verifyRecordType.REG))).returning().get();
		} else {
			return orm(c).insert(verifyRecord).values({ip, type: verifyRecordType.REG}).returning().get();
		}
	},

	async increaseAddCount(c) {

		const ip = reqUtils.getIp(c)
		const row = await this.selectByIPAndType(c, verifyRecordType.ADD);
		const now = dayjs().format('YYYY-MM-DD HH:mm:ss');

		if (row) {
			return orm(c).update(verifyRecord).set({
				count: sql`${verifyRecord.count}
		+ 1`, updateTime: now
			}).where(and(eq(verifyRecord.ip, ip),eq(verifyRecord.type,verifyRecordType.ADD))).returning().get();
		} else {
			return orm(c).insert(verifyRecord).values({ip, type: verifyRecordType.ADD}).returning().get();
		}
	},

	async clearLoginCount(c) {
		const ip = reqUtils.getIp(c);
		await orm(c).delete(verifyRecord).where(and(eq(verifyRecord.ip, ip), eq(verifyRecord.type, verifyRecordType.LOGIN))).run();
	},

	async loginLockState(c, maxFailedAttempts, failWindowMinutes, lockHours) {
		const row = await this.selectByIPAndType(c, verifyRecordType.LOGIN);
		if (!row) {
			return { locked: false, count: 0, remainingMinutes: 0 };
		}

		const now = dayjs();
		const updatedAt = dayjs(row.updateTime);
		const lockExpiresAt = updatedAt.add(lockHours, 'hour');

		if (row.count >= maxFailedAttempts && lockExpiresAt.isAfter(now)) {
			return {
				locked: true,
				count: row.count,
				remainingMinutes: Math.max(lockExpiresAt.diff(now, 'minute'), 1)
			};
		}

		const windowExpiresAt = updatedAt.add(failWindowMinutes, 'minute');
		if (windowExpiresAt.isBefore(now)) {
			await this.clearLoginCount(c);
			return { locked: false, count: 0, remainingMinutes: 0 };
		}

		return { locked: false, count: row.count, remainingMinutes: 0 };
	},

	async increaseLoginCount(c, maxFailedAttempts, failWindowMinutes, lockHours) {
		const ip = reqUtils.getIp(c);
		const row = await this.selectByIPAndType(c, verifyRecordType.LOGIN);
		const now = dayjs();
		const nowText = now.format('YYYY-MM-DD HH:mm:ss');

		if (!row) {
			const inserted = await orm(c).insert(verifyRecord).values({
				ip,
				type: verifyRecordType.LOGIN,
				count: 1,
				updateTime: nowText
			}).returning().get();
			return { locked: false, count: inserted.count, remainingMinutes: 0 };
		}

		const updatedAt = dayjs(row.updateTime);
		const lockExpiresAt = updatedAt.add(lockHours, 'hour');
		if (row.count >= maxFailedAttempts && lockExpiresAt.isAfter(now)) {
			return {
				locked: true,
				count: row.count,
				remainingMinutes: Math.max(lockExpiresAt.diff(now, 'minute'), 1)
			};
		}

		const windowExpiresAt = updatedAt.add(failWindowMinutes, 'minute');
		const nextCount = windowExpiresAt.isBefore(now) ? 1 : row.count + 1;
		const saved = await orm(c).update(verifyRecord).set({
			count: nextCount,
			updateTime: nowText
		}).where(and(eq(verifyRecord.ip, ip), eq(verifyRecord.type, verifyRecordType.LOGIN))).returning().get();

		if (saved.count >= maxFailedAttempts) {
			return {
				locked: true,
				count: saved.count,
				remainingMinutes: lockHours * 60
			};
		}

		return { locked: false, count: saved.count, remainingMinutes: 0 };
	}

};

export default verifyRecordService;

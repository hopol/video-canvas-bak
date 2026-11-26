-- 设备授权记录发起方的来源 IP：授权页展示给确认的人，让他核对「这次登录是不是我自己发起的」。
-- 设备码钓鱼的做法是让受害者点别人发起的授权，只有一个调用方自填的名字时，受害者无从分辨。
-- 只加列：旧记录是空串，授权页遇到空串就不展示 IP（这些记录最多存活 10 分钟）。
ALTER TABLE cli_device_codes ADD COLUMN created_ip varchar(45) NOT NULL DEFAULT '';

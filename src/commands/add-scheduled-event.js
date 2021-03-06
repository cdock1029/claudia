/*global module, require */
var loadConfig = require('../util/loadconfig'),
	Promise = require('bluebird'),
	fs = Promise.promisifyAll(require('fs')),
	aws = require('aws-sdk');

module.exports = function addScheduledEvent(options) {
	'use strict';
	var lambdaConfig,
		lambda,
		events,
		eventData,
		ruleArn,
		initServices = function () {
			lambda = Promise.promisifyAll(new aws.Lambda({region: lambdaConfig.region}), {suffix: 'Promise'});
			events = Promise.promisifyAll(new aws.CloudWatchEvents({region: lambdaConfig.region}));
		},
		getLambda = function () {
			return lambda.getFunctionConfigurationPromise({FunctionName: lambdaConfig.name, Qualifier: options.version});
		},
		readConfig = function () {
			return loadConfig(options, {lambda: {name: true, region: true, role: true}})
				.then(function (config) {
					lambdaConfig = config.lambda;
				}).then(initServices)
				.then(getLambda)
				.then(function (result) {
					lambdaConfig.arn = result.FunctionArn;
					lambdaConfig.version = result.Version;
				});
		},
		addInvokePermission = function () {
			return lambda.addPermissionPromise({
				Action: 'lambda:InvokeFunction',
				FunctionName: lambdaConfig.name,
				Principal: 'events.amazonaws.com',
				SourceArn: ruleArn,
				Qualifier: options.version,
				StatementId:  options.name  + '-access-' + Date.now()
			});
		},
		createRule = function () {
			return events.putRuleAsync({
				Name: options.name,
				ScheduleExpression: options.schedule
			});
		},
		addRuleTarget = function () {
			return events.putTargetsAsync({
				Rule: options.name,
				Targets: [
					{
						Arn: lambdaConfig.arn,
						Id: lambdaConfig.name + '-' + options.version + '-' + Date.now(),
						Input: eventData
					}
				]
			});
		};
	if (options.rate) {
		options.schedule = 'rate(' + options.rate + ')';
	}
	if (options.cron) {
		options.schedule = 'cron(' + options.cron + ')';
	}
	if (!options.event) {
		return Promise.reject('event file not specified. please provide it with --event');
	}
	if (!options.name) {
		return Promise.reject('event name not specified. please provide it with --name');
	}
	if (!options.schedule) {
		return Promise.reject('event schedule not specified. please provide it with --schedule');
	}
	return fs.readFileAsync(options.event, 'utf8')
		.then(function (contents) {
			eventData = contents;
		}).then(readConfig)
		.then(createRule)
		.then(function (eventResult) {
			ruleArn = eventResult.RuleArn;
		}).then(addInvokePermission)
		.then(addRuleTarget);
};

module.exports.doc = {
	description: 'Add a recurring notification event',
	priority: 7,
	args: [
		{
			argument: 'event',
			description: 'Path to a JSON event file that will be sent to lambda periodically'
		},
		{
			argument: 'name',
			description: 'Name for the scheduled event rule that will be created'
		},
		{
			argument: 'schedule',
			description: 'A schedule expression. For syntax options, see\n' +
				'http://docs.aws.amazon.com/AmazonCloudWatch/latest/DeveloperGuide/ScheduledEvents.html',
			example: 'rate(5 minutes)'
		},
		{
			argument: 'rate',
			optional: true,
			description: 'a shorthand for rate-based expressions, without the brackets.\n' +
				'If this is specified, the schedule argument is not required/ignored',
			example: '5 minutes'
		},
		{
			argument: 'cron',
			optional: true,
			description: 'a shorthand for cron-based expressions, without the brackets.\n' +
				'If this is specified, the schedule argument is not required/ignored',
			example: '0 8 1 * ? *'
		},
		{
			argument: 'version',
			optional: true,
			description: 'Bind to a particular version',
			example: 'production',
			default: 'latest version'
		},
		{
			argument: 'source',
			optional: true,
			description: 'Directory with project files',
			default: 'current directory'
		},
		{
			argument: 'config',
			optional: true,
			description: 'Config file containing the resource names',
			default: 'claudia.json'
		}
	]
};

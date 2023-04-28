#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Ec2VolModules } from '../lib/cdk-module-factory-stack';

const app = new cdk.App();
new Ec2VolModules(app, 'Ec2VolModules', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
});
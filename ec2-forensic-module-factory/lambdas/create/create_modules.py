import json
import os
import boto3
import time
import logging
from botocore.exceptions import ClientError

logger=logging.getLogger()
logger.setLevel(logging.INFO)

ec2 = boto3.client('ec2')
ssm = boto3.client('ssm')

SECURITY_GROUP_ID = os.environ['SECURITY_GROUP_ID']
SUBNET_ID = os.environ['SUBNET_ID']
INSTANCE_PROFILE = os.environ['INSTANCE_PROFILE']
KMS_KEY_ID = os.environ['KMS_KEY_ID']
S3_BUCKET = os.environ['S3_BUCKET']
SSM_DOC = os.environ['SSM_DOC']
REGION = os.environ['REGION']

def get_architecture(AMI_ID):
    ami = ec2.describe_images(ImageIds=[AMI_ID])
    architecture = ami['Images'][0]['Architecture']
    logger.info('Architecture is {}'.format(architecture))
    return architecture

def start_ec2_instance(AMI_ID):
    """Function to launch the AMI Updater Instance."""
    logger.info('Launching EC2 instance using {} to create EC2 forensic modules...'.format(AMI_ID))
    architecture = get_architecture(AMI_ID)
    try:
        ec2instance = ec2.run_instances(
            ImageId=AMI_ID,
            InstanceType="t3.micro" if architecture == 'x86_64' else 'c6g.medium',
            MaxCount=1,
            MinCount=1,
            InstanceInitiatedShutdownBehavior='stop',
            SecurityGroupIds=[
                SECURITY_GROUP_ID
                ],
            SubnetId=SUBNET_ID,
            IamInstanceProfile={
                'Arn': INSTANCE_PROFILE
            }
            )
        InstanceId = ec2instance['Instances'][0]['InstanceId']
        logger.info('EC2 instance {} to build modules has successfully launched.'.format(InstanceId))
        time.sleep(15)
        return InstanceId
    except Exception as exception_handle:
        logger.error(exception_handle)


def check_ec2_instance(InstanceId):
    """Function to check EC2 Instance status."""
    response = ec2.describe_instance_status(
        InstanceIds=[
            InstanceId,
            ]
        )
    if response['InstanceStatuses'][0]['SystemStatus']['Status'] == 'ok':
        logger.info("Instance is ready to run SSM command!")
        time.sleep(10)
        return True
    else:
        logger.info("Instance {} is {}...".format(InstanceId, response['InstanceStatuses'][0]['SystemStatus']['Status']))
        time.sleep(30)
        return False

def run_ssm_doc(InstanceId, kernelversion, TaskToken):
    """Function to run command via SSM document on EC2."""
    time.sleep(60)
    logger.info('Attempting SSM run command on {} for kernel version {}...' .format(InstanceId, kernelversion))
    try:
        Target_CommandId = ssm.send_command(
            InstanceIds = [InstanceId],
            DocumentName = SSM_DOC,
            TimeoutSeconds=360,
            Comment='Provision EC2 instance to create forensic investigation modules.',
            Parameters={
                'TaskToken': [TaskToken],
                'EC2InstanceId':[InstanceId],
                's3bucket': [S3_BUCKET],
                'Region': [REGION],
                'kernelversion': [kernelversion]
            },
            MaxErrors='0',
            OutputS3BucketName=S3_BUCKET,
            OutputS3KeyPrefix='ec2_module_build_logs'
        )['Command']['CommandId']
        logger.info('SSM command {} in progress...' .format(Target_CommandId))
    except ClientError as error_handle:
        if error_handle.response['Error']['Code'] == 'InvalidParameters':                
            logger.warning(error_handle.response['Error']['Code'])
            logger.info('Fix the SSM parameters! Deleting the EC2 instance {}...' .format(InstanceId))
            delete_instances(InstanceId)
        else:
            logger.error(error_handle.response['Error']['Code'])
            logger.info('Deleting EC2 instance {}...' .format(InstanceId))
            delete_instances(InstanceId)

def delete_instances(InstanceId):
    """Function to delete the Instance IDs from forensic AWS account."""
    logger.info('Attempting to delete instance {}...' .format(InstanceId))
    try:
        ec2.terminate_instances(
            InstanceIds=[
                InstanceId
            ],
            DryRun=False
        )
        logger.info('{} has been successfully deleted' .format(InstanceId))
    except Exception as exception_handle:
        logger.error(exception_handle)

def lambda_handler(event, context):
    print (event)
    AMI_ID = event['input']['AMI_ID']
    if 'kernelversion' in event['input']:
        kernelversion = event['input']['kernelversion']
        logger.info('Building modules for {} using {}' .format(kernelversion, AMI_ID))
    else:
        logger.info('No kernel version was provided.. using the default kernel version in {}' .format(AMI_ID))
        kernelversion = "$(uname -r)"
    TaskToken = event['token']
    InstanceId = start_ec2_instance(AMI_ID)
    start_ec2_instance_complete = False
    while start_ec2_instance_complete == False:
        start_ec2_instance_complete = check_ec2_instance(InstanceId)
    run_ssm_doc(InstanceId, kernelversion, TaskToken)
    
